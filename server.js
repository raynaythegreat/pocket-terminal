require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
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

/**
 * Tool definitions and resolution
 */
const TOOLS = [
  {
    id: "shell",
    name: "Terminal",
    sub: "Standard Shell",
    bin: process.platform === "win32" ? "powershell.exe" : "bash",
    args: [],
    badge: "System",
    badgeClass: "badge-muted",
  },
  {
    id: "opencode",
    name: "openCode",
    sub: "AI coding agent",
    bin: "opencode",
    pkg: null, // Repo script
    badge: "Repo",
    hint: "Uses the ./opencode script in this repository.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    sub: "Google AI CLI",
    bin: "gemini",
    pkg: "@google/gemini-cli",
    badge: "AI",
    hint: "To use your Google Account, run: gcloud auth application-default login --no-launch-browser",
  },
  {
    id: "grok",
    name: "Grok CLI",
    sub: "xAI Grok",
    bin: "grok",
    pkg: "@vibe-kit/grok-cli",
    badge: "AI",
    hint: "Login with: grok login (or set XAI_API_KEY in env)",
  },
  {
    id: "claude",
    name: "Claude Code",
    sub: "Anthropic Agent",
    bin: "claude",
    pkg: "@anthropic-ai/claude-code",
    badge: "AI",
    hint: "Requires ANTHROPIC_API_KEY",
  },
  {
    id: "copilot",
    name: "Copilot",
    sub: "GitHub CLI",
    bin: "gh",
    pkg: "@github/copilot",
    badge: "AI",
    hint: "Run: gh auth login",
  },
];

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

function resolveCommand(toolId) {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) return null;

  // 1. Check Repo root
  const repoPath = path.resolve(__dirname, tool.bin);
  if (isExecutableFile(repoPath)) return repoPath;

  // 2. Check LOCAL_BIN_DIR (includes gcloud installed by build.sh)
  const localBin = path.join(LOCAL_BIN_DIR, tool.bin);
  if (isExecutableFile(localBin)) return localBin;

  // 3. Check node_modules/.bin
  const nodeBin = path.join(NODE_MODULES_BIN_DIR, tool.bin);
  if (isExecutableFile(nodeBin)) return nodeBin;

  // 4. Check PATH
  return tool.bin;
}

/**
 * API: Tools list
 */
app.get("/api/tools", (req, res) => {
  const list = TOOLS.map((t) => {
    const resolved = resolveCommand(t.id);
    const isReady = resolved && (path.isAbsolute(resolved) || resolved === "bash" || resolved === "powershell.exe");
    return {
      ...t,
      isReady: !!isReady,
      resolvedPath: resolved,
    };
  });
  res.json(list);
});

/**
 * Health check
 */
app.get("/healthz", (req, res) => res.send("OK"));

/**
 * WebSocket handling
 */
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const toolId = url.searchParams.get("tool") || "shell";
  const tool = TOOLS.find((t) => t.id === toolId) || TOOLS[0];

  const toolHome = path.join(CLI_HOME_DIR, "tools", toolId);
  if (!fs.existsSync(toolHome)) fs.mkdirSync(toolHome, { recursive: true });

  const resolvedBin = resolveCommand(toolId);
  
  // Build environment
  const env = {
    ...process.env,
    HOME: toolHome,
    USERPROFILE: toolHome, // Windows
    PATH: `${LOCAL_BIN_DIR}${path.delimiter}${NODE_MODULES_BIN_DIR}${path.delimiter}${process.env.PATH}`,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
    POCKET_TERMINAL: "1",
  };

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(resolvedBin, tool.args || [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: WORKSPACE_DIR,
      env,
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[31mFailed to launch tool: ${err.message}\x1b[0m\r\n` }));
    ws.close();
    return;
  }

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "data", data }));
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });

  ws.on("message", (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === "data") ptyProcess.write(msg.data);
      if (msg.type === "resize") ptyProcess.resize(msg.cols || 80, msg.rows || 24);
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`CLI Home: ${CLI_HOME_DIR}`);
});