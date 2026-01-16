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

const CLI_HOME_DIR = path.resolve(__dirname, process.env.CLI_HOME_DIR || path.join("workspace", "cli-home"));
const WORKSPACE_DIR = path.resolve(__dirname, process.env.WORKSPACE_DIR || path.join("workspace", "projects"));
const LOCAL_BIN_DIR = path.join(__dirname, "bin");

// Ensure directories exist
for (const d of [CLI_HOME_DIR, WORKSPACE_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const TOOL_CONFIG = {
  shell: { id: "shell", title: "Shell", command: process.platform === "win32" ? "cmd.exe" : "bash", args: [] },
  gh: { id: "gh", title: "GitHub CLI", command: "gh", args: [] },
  copilot: { id: "copilot", title: "Copilot", command: "github-copilot-cli", args: [] },
  gemini: { id: "gemini", title: "Gemini", command: "gemini-cli", args: [] },
  gcloud: { id: "gcloud", title: "gcloud", command: "gcloud", args: [] },
  opencode: { id: "opencode", title: "opencode", command: "opencode", args: [] },
  kimi: { id: "kimi", title: "kimi", command: "kimi", args: [] },
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

  const env = {
    ...process.env,
    HOME: CLI_HOME_DIR,
    PATH: `${LOCAL_BIN_DIR}${path.delimiter}${process.env.PATH}`,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  const ptyProcess = pty.spawn(tool.command, tool.args, {
    name: "xterm-color",
    cols,
    rows,
    cwd: WORKSPACE_DIR,
    env,
  });

  console.log(`Started ${tool.id} pty (pid: ${ptyProcess.pid})`);

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
    } catch (e) {}
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Terminal running at http://0.0.0.0:${PORT}`);
  console.log(`Authentication is DISABLED.`);
});