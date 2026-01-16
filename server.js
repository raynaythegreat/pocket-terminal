require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3000;

const CLI_HOME_DIR = path.resolve(
  __dirname,
  process.env.CLI_HOME_DIR || path.join("workspace", "cli-home")
);
const WORKSPACE_DIR = path.resolve(
  __dirname,
  process.env.WORKSPACE_DIR || path.join("workspace", "projects")
);
const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_MODULES_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

// Ensure directories exist
for (const d of [CLI_HOME_DIR, WORKSPACE_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === "win32") return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function firstExistingExecutable(candidates) {
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function resolveLocalBin(bin) {
  const candidates = [
    path.join(LOCAL_BIN_DIR, bin),
    path.join(NODE_MODULES_BIN_DIR, bin),
  ];

  if (process.platform === "win32") {
    const exts = [".cmd", ".exe", ".bat"];
    const bases = [path.join(LOCAL_BIN_DIR, bin), path.join(NODE_MODULES_BIN_DIR, bin)];
    for (const base of bases) for (const ext of exts) candidates.push(base + ext);
  }

  return firstExistingExecutable(candidates);
}

function buildPathEnv() {
  const parts = [];
  parts.push(LOCAL_BIN_DIR);
  parts.push(NODE_MODULES_BIN_DIR);
  if (process.env.PATH) parts.push(process.env.PATH);
  return parts.filter(Boolean).join(path.delimiter);
}

/**
 * Resolve a command to spawn.
 * - Prefer repo script if provided (e.g. ./opencode)
 * - Prefer local bin in ./bin or node_modules/.bin
 * - Else use a plain command name (may exist in PATH)
 * - Else fallback to: npx -y <packageName>
 *
 * @param {{bin?: string, packageName?: string, preferRepoScript?: string}} spec
 * @returns {{command: string, args: string[], resolution: string}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;
  const preferRepoScript = spec.preferRepoScript;

  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p)) return { command: p, args: [], resolution: `script:${preferRepoScript}` };
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      // Try via node for non-executable JS scripts
      return { command: process.execPath, args: [p], resolution: `node:${preferRepoScript}` };
    }
  }

  if (bin) {
    const local = resolveLocalBin(bin);
    if (local) return { command: local, args: [], resolution: `localbin:${bin}` };
    return { command: bin, args: [], resolution: `pathbin:${bin}` };
  }

  if (packageName) {
    return { command: "npx", args: ["-y", packageName], resolution: `npx:${packageName}` };
  }

  return { command: "bash", args: ["-lc", "bash"], resolution: "fallback-shell" };
}

function isUnixLike() {
  return process.platform !== "win32";
}

/**
 * Wrap a command in an interactive login shell for more stable PATH/env behavior.
 * On Windows, return as-is.
 * @param {{command: string, args: string[]}} cmd
 * @returns {{command: string, args: string[]}}
 */
function wrapInShell(cmd) {
  if (!isUnixLike()) return cmd;
  // Safely-ish join for bash -lc. We avoid complex quoting by using a simple join
  // and relying on known binaries; arguments can still contain spaces in edge cases.
  const line = [cmd.command, ...cmd.args].join(" ");
  return { command: "bash", args: ["-lc", line] };
}

const TOOL_CONFIG = {
  shell: { title: "Shell", bin: "bash" },
  gh: { title: "GitHub CLI", bin: "gh" },
  copilot: { title: "Copilot", bin: "github-copilot-cli", packageName: "@github/copilot" },
  gemini: { title: "Gemini", bin: "gemini", packageName: "@google/gemini-cli" },
  claude: { title: "Claude Code", bin: "claude", packageName: "@anthropic-ai/claude-code" },
  codex: { title: "Codex", bin: "codex", packageName: "@openai/codex" },
  grok: { title: "Grok", bin: "grok", packageName: "@vibe-kit/grok-cli" },
  cline: { title: "Cline", bin: "cline", packageName: "@kilocode/cli" },

  // OpenCode: prefer repo script if present, else bin, else npx fallback
  opencode: { title: "OpenCode", bin: "opencode", packageName: "opencode", preferRepoScript: "./opencode" },
};

wss.on("connection", (ws) => {
  let ptyProcess = null;
  let alive = true;

  function safeSend(type, payload) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function writeSystem(line) {
    safeSend("output", { data: `\r\n\x1b[90m${line}\x1b[0m\r\n` });
  }

  function cleanup() {
    if (!alive) return;
    alive = false;
    try {
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // ignore
        }
      }
    } finally {
      ptyProcess = null;
    }
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "start") {
      const tool = typeof msg.tool === "string" ? msg.tool : "shell";
      const cfg = TOOL_CONFIG[tool] || TOOL_CONFIG.shell;

      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // ignore
        }
        ptyProcess = null;
      }

      const resolved = resolveCommand({
        bin: cfg.bin,
        packageName: cfg.packageName,
        preferRepoScript: cfg.preferRepoScript,
      });

      const finalCmd = wrapInShell({ command: resolved.command, args: resolved.args });

      const env = {
        ...process.env,
        HOME: CLI_HOME_DIR,
        CLI_HOME: CLI_HOME_DIR,
        WORKSPACE_DIR,
        PATH: buildPathEnv(),
        TERM: "xterm-256color",
      };

      writeSystem(`Starting ${cfg.title} (${tool})`);
      writeSystem(`Resolution: ${resolved.resolution}`);
      if (finalCmd.command !== resolved.command || finalCmd.args.join(" ") !== resolved.args.join(" ")) {
        writeSystem(`Shell wrapper: ${finalCmd.command} ${finalCmd.args.join(" ")}`);
      }

      try {
        ptyProcess = pty.spawn(finalCmd.command, finalCmd.args, {
          name: "xterm-256color",
          cols: Number(msg.cols) || 80,
          rows: Number(msg.rows) || 24,
          cwd: WORKSPACE_DIR,
          env,
        });
      } catch (e) {
        writeSystem(`Failed to spawn: ${String(e && e.message ? e.message : e)}`);
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }

      ptyProcess.onData((data) => {
        safeSend("output", { data });
      });

      ptyProcess.onExit((ev) => {
        const code = ev && typeof ev.exitCode === "number" ? ev.exitCode : null;
        const sig = ev && typeof ev.signal === "number" ? ev.signal : null;
        writeSystem(`Process exited${code !== null ? ` (code ${code})` : ""}${sig !== null ? ` (signal ${sig})` : ""}.`);
        // Close shortly after flushing message
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }, 120);
      });

      return;
    }

    if (msg.type === "input") {
      if (!ptyProcess) return;
      if (typeof msg.data !== "string") return;
      try {
        ptyProcess.write(msg.data);
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === "resize") {
      if (!ptyProcess) return;
      const cols = Number(msg.cols);
      const rows = Number(msg.rows);
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
      try {
        ptyProcess.resize(cols, rows);
      } catch {
        // ignore
      }
    }
  });

  ws.on("close", () => cleanup());
  ws.on("error", () => cleanup());
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

server.listen(PORT, () => {
  console.log(`Pocket Terminal listening on :${PORT}`);
  console.log(`WORKSPACE_DIR=${WORKSPACE_DIR}`);
  console.log(`CLI_HOME_DIR=${CLI_HOME_DIR}`);
});