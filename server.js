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
  for (reflect of candidates) {
    // noop (placeholder to avoid lint) - will be overwritten below
  }
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

/**
 * Resolve a command to spawn.
 * - Prefer local bin in ./bin or node_modules/.bin
 * - Else use a plain command name (may exist in PATH)
 * - Else (if provided) fallback to: npx -y <packageName>
 *
 * @param {{bin?: string, packageName?: string, preferRepoScript?: string}} spec
 * @returns {{command: string, args: string[]}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;
  const preferRepoScript = spec.preferRepoScript;

  // Prefer a repo script if requested (e.g. ./opencode)
  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p)) return { command: p, args: [] };
    // If it's a file but not executable, try via node
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return { command: process.execPath, args: [p] };
    }
  }

  if (bin) {
    const local = resolveLocalBin(bin);
    if (local) return { command: local, args: [] };
    // try by name (PATH)
    return { command: bin, args: [] };
  }

  if (packageName) {
    return { command: "npx", args: ["-y", packageName] };
  }

  return {
    command: process.platform === "win32" ? "cmd.exe" : "bash",
    args: [],
  };
}

function resolveWithNpxFallback({ bin, packageName, preferRepoScript }) {
  // Try local/path bin first; if that fails at runtime we'll fallback by spawning npx.
  // Here we choose a "best guess" command. Runtime fallback is handled by shell wrapper below.
  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p) || fs.existsSync(p)) {
      return resolveCommand({ preferRepoScript });
    }
  }

  const local = bin ? resolveLocalBin(bin) : null;
  if (local) return { command: local, args: [], fallback: packageName ? { command: "npx", args: ["-y", packageName] } : null };

  if (bin) return { command: bin, args: [], fallback: packageName ? { command: "npx", args: ["-y", packageName] } : null };

  if (packageName) return { command: "npx", args: ["-y", packageName], fallback: null };

  return { command: process.platform === "win32" ? "cmd.exe" : "bash", args: [], fallback: null };
}

function shellWrap(command, args) {
  // On unix, run via login shell for consistent PATH/rc files
  if (process.platform !== "win32") {
    const joined = [command, ...args].map((s) => {
      // basic shell escaping
      if (/^[a-zA-Z0-9_./:-]+$/.test(s)) return s;
      return `'${String(s).replace(/'/g, `'\\''`)}'`;
    }).join(" ");

    // Use "command -v" to check existence; if missing, attempt npx when original is a bare name.
    return { command: "bash", args: ["-lc", joined] };
  }

  // On Windows, just run directly (cmd.exe can be added later if needed)
  return { command, args };
}

const TOOL_CONFIG = {
  shell: {
    id: "shell",
    title: "Shell",
    resolve: () => ({
      command: process.platform === "win32" ? "cmd.exe" : "bash",
      args: [],
    }),
  },

  gh: {
    id: "gh",
    title: "GitHub CLI",
    resolve: () => {
      // Prefer gh binary; fallback to npx if not present.
      const r = resolveWithNpxFallback({ bin: "gh", packageName: null });
      // For stability, start an interactive shell and print guidance + keep it open.
      if (process.platform !== "win32") {
        const script = [
          "echo 'GitHub CLI session.'",
          "echo 'Tip: run: gh auth login'",
          "echo 'Then use gh commands (e.g., gh repo view).'",
          "echo ''",
          "exec bash -i",
        ].join("\n");
        return { command: "bash", args: ["-lc", script] };
      }
      return r;
    },
  },

  copilot: {
    id: "copilot",
    title: "Copilot",
    resolve: () => resolveWithNpxFallback({ bin: "copilot", packageName: "@github/copilot" }),
  },

  gemini: {
    id: "gemini",
    title: "Gemini",
    resolve: () => resolveWithNpxFallback({ bin: "gemini", packageName: "@google/gemini-cli" }),
  },

  claude: {
    id: "claude",
    title: "Claude Code",
    resolve: () => resolveWithNpxFallback({ bin: "claude", packageName: "@anthropic-ai/claude-code" }),
  },

  codex: {
    id: "codex",
    title: "Codex",
    resolve: () => resolveWithNpxFallback({ bin: "codex", packageName: "@openai/codex" }),
  },

  grok: {
    id: "grok",
    title: "Grok",
    resolve: () => resolveWithNpxFallback({ bin: "grok", packageName: "@vibe-kit/grok-cli" }),
  },

  cline: {
    id: "cline",
    title: "Cline",
    resolve: () => resolveWithNpxFallback({ bin: "cline", packageName: "@kilocode/cli" }),
  },

  opencode: {
    id: "opencode",
    title: "OpenCode",
    resolve: () =>
      resolveWithNpxFallback({
        preferRepoScript: "./opencode",
        bin: "opencode",
        packageName: "opencode",
      }),
  },
};

function getToolFromReq(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const tool = url.searchParams.get("tool") || "shell";
    if (TOOL_CONFIG[tool]) return tool;
    return "shell";
  } catch {
    return "shell";
  }
}

function buildPtyEnv() {
  const base = { ...process.env };

  // Strongly prefer our local bins in PATH
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = base.PATH || base.Path || "";
  const extra = [LOCAL_BIN_DIR, NODE_MODULES_BIN_DIR].join(sep);
  base.PATH = extra + (existing ? sep + existing : "");

  base.HOME = CLI_HOME_DIR;
  base.USERPROFILE = CLI_HOME_DIR;

  return base;
}

wss.on("connection", (socket, req) => {
  const tool = getToolFromReq(req);
  const cfg = TOOL_CONFIG[tool] || TOOL_CONFIG.shell;

  const resolved = cfg.resolve();
  const command = resolved.command;
  const args = resolved.args || [];
  const fallback = resolved.fallback || null;

  const env = buildPtyEnv();

  const ptyOpts = {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: WORKSPACE_DIR,
    env,
  };

  let proc = null;
  let closed = false;

  function send(type, data) {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ type, data }));
  }

  function spawnProcess(cmd, cmdArgs) {
    try {
      const wrapped = shellWrap(cmd, cmdArgs);
      proc = pty.spawn(wrapped.command, wrapped.args, ptyOpts);

      proc.onData((data) => send("output", data));
      proc.onExit(({ exitCode, signal }) => {
        if (closed) return;
        send("system", `Process exited (code=${exitCode}${signal ? `, signal=${signal}` : ""}).`);
        // Close shortly after so the client shows retry
        setTimeout(() => {
          try {
            socket.close();
          } catch {
            // ignore
          }
        }, 150);
      });

      return true;
    } catch (e) {
      send("error", String(e && e.message ? e.message : e));
      return false;
    }
  }

  // Spawn primary; if it throws synchronously, try fallback (npx)
  const ok = spawnProcess(command, args);
  if (!ok && fallback) {
    spawnProcess(fallback.command, fallback.args);
  }

  socket.on("message", (raw) => {
    if (!proc) return;

    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "input" && typeof msg.data === "string") {
      try {
        proc.write(msg.data);
      } catch {
        // ignore
      }
    } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
      try {
        proc.resize(msg.cols, msg.rows);
      } catch {
        // ignore
      }
    }
  });

  socket.on("close", () => {
    closed = true;
    try {
      if (proc) proc.kill();
    } catch {
      // ignore
    }
    proc = null;
  });

  socket.on("error", () => {
    // ignore; close handler will clean up
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal listening on http://localhost:${PORT}`);
});