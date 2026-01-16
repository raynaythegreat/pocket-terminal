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
    // On Windows, "executable" isn't meaningful; presence is enough.
    if (process.platform === "win32") return true;
    // Basic executable bit check
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a command to spawn.
 * - Prefer a direct binary (found via PATH at runtime / node-pty spawn),
 *   but we can also point to known local paths (./bin, node_modules/.bin).
 * - If not available, fall back to: npx -y <packageName>
 *
 * @param {{bin?: string, packageName?: string}} spec
 * @returns {{command: string, args: string[]}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;

  // Prefer explicit bin if available from our known local dirs.
  if (bin) {
    const candidates = [
      path.join(LOCAL_BIN_DIR, bin),
      path.join(NODE_MODULES_BIN_DIR, bin),
    ];

    // Add Windows extensions to candidates.
    if (process.platform === "win32") {
      const winExts = [".cmd", ".exe", ".bat"];
      for (const base of [path.join(LOCAL_BIN_DIR, bin), path.join(NODE_MODULES_BIN_DIR, bin)]) {
        for (const ext of winExts) candidates.push(base + ext);
      }
    }

    for (const candidate of candidates) {
      if (isExecutableFile(candidate)) {
        return { command: candidate, args: [] };
      }
    }

    // If not found in explicit local locations, still try by name
    // (it may exist in PATH in the host).
    return { command: bin, args: [] };
  }

  if (packageName) {
    return { command: "npx", args: ["-y", packageName] };
  }

  // Ultimate fallback: shell
  return {
    command: process.platform === "win32" ? "cmd.exe" : "bash",
    args: [],
  };
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
    resolve: () => resolveCommand({ bin: "gh" }),
  },
  copilot: {
    id: "copilot",
    title: "Copilot",
    resolve: () => resolveCommand({ bin: "github-copilot-cli", packageName: "@github/copilot" }),
  },
  gemini: {
    id: "gemini",
    title: "Gemini",
    resolve: () => resolveCommand({ bin: "gemini-cli", packageName: "@google/gemini-cli" }),
  },
  opencode: {
    id: "opencode",
    title: "opencode",
    resolve: () => resolveCommand({ bin: "opencode", packageName: "@openai/opencode" }),
  },
  kimi: {
    id: "kimi",
    title: "kimi",
    resolve: () => resolveCommand({ bin: "kimi", packageName: "@kilocode/cli" }),
  },

  // Newly added tools
  claude: {
    id: "claude",
    title: "Claude Code",
    // Common bin names are "claude" / "claude-code". We'll prefer "claude" but
    // if users installed differently, npx fallback still works.
    resolve: () => resolveCommand({ bin: "claude", packageName: "@anthropic-ai/claude-code" }),
  },
  codex: {
    id: "codex",
    title: "Codex",
    resolve: () => resolveCommand({ bin: "codex", packageName: "@openai/codex" }),
  },
  grok: {
    id: "grok",
    title: "Grok",
    // Some distributions may expose "grok" or "grok-cli"; we use "grok" and npx fallback.
    resolve: () => resolveCommand({ bin: "grok", packageName: "@vibe-kit/grok-cli" }),
  },
  cline: {
    id: "cline",
    title: "Cline",
    // KiloCode historically uses "kilo"/"kilocode" in some setups; we assume "cline" and npx fallback.
    resolve: () => resolveCommand({ bin: "cline", packageName: "@kilocode/cli" }),
  },
};

// Health check endpoint
app.get("/healthz", (req, res) => res.status(200).send("OK"));

// WebSocket Handling
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const toolId = url.searchParams.get("tool") || "shell";
  const tool = TOOL_CONFIG[toolId] || TOOL_CONFIG.shell;

  const cols = parseInt(url.searchParams.get("cols"), 10) || 80;
  const rows = parseInt(url.searchParams.get("rows"), 10) || 24;

  const resolved = typeof tool.resolve === "function" ? tool.resolve() : resolveCommand({ bin: tool.command });

  const env = {
    ...process.env,
    HOME: CLI_HOME_DIR,
    // Ensure our local bins and node_modules/.bin are first in PATH so optionalDependencies work.
    PATH: `${LOCAL_BIN_DIR}${path.delimiter}${NODE_MODULES_BIN_DIR}${path.delimiter}${process.env.PATH || ""}`,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  const ptyProcess = pty.spawn(resolved.command, resolved.args || [], {
    name: "xterm-color",
    cols,
    rows,
    cwd: WORKSPACE_DIR,
    env,
  });

  console.log(`Started ${tool.id} pty (pid: ${ptyProcess.pid}) -> ${resolved.command}`);

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ws.on("message", (message) => {
    const msg = message.toString();
    try {
      const data = JSON.parse(msg);
      if (data.type === "input") {
        ptyProcess.write(data.content);
      } else if (data.type === "resize") {
        ptyProcess.resize(data.cols, data.rows);
      }
    } catch (e) {
      // Raw string input fallback
      ptyProcess.write(msg);
    }
  });

  const cleanup = () => {
    try {
      ptyProcess.kill();
      console.log(`Killed pty (pid: ${ptyProcess.pid})`);
    } catch (e) {
      // ignore
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  ptyProcess.onExit(() => {
    try {
      ws.close();
    } catch (e) {
      // ignore
    }
  });
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal running at http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`CLI_HOME: ${CLI_HOME_DIR}`);
});