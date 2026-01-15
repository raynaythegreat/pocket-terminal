const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// Ensure password is trimmed and defaults to 'pocket' if not set
const PASSWORD = (process.env.TERMINAL_PASSWORD || "Superprimitive69!").trim();
const PROJECTS_DIR = path.join(__dirname, "projects");

// Global store for terminal sessions: sessionId -> { term, lastActive }
const sessions = new Map();

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static("public"));
app.use(express.json());

// Auth middleware for REST API
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (token && token.trim() === PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// API: List Projects
app.get("/api/projects", authMiddleware, (req, res) => {
  try {
    const folders = fs
      .readdirSync(PROJECTS_DIR)
      .filter((file) =>
        fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory(),
      );
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Clone Repository with Token Support
app.post("/api/projects/clone", authMiddleware, (req, res) => {
  const { url, token } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });

  // Handle Private Repos by injecting token if provided
  let cloneUrl = url;
  if (token && url.startsWith("https://github.com/")) {
    cloneUrl = url.replace(
      "https://github.com/",
      `https://${token}@github.com/`,
    );
  }

  const repoName = url.split("/").pop().replace(".git", "");
  const targetPath = path.join(PROJECTS_DIR, repoName);

  if (fs.existsSync(targetPath)) {
    return res.status(400).json({ error: "Project already exists" });
  }

  exec(`git clone ${cloneUrl} ${repoName}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ name: repoName });
  });
});

wss.on("connection", (ws) => {
  let authenticated = false;
  let sessionKey = null;

  ws.on("message", (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return;
    }

    // 1. Mandatory Auth Handshake
    if (msg.type === "auth") {
      if (msg.password && msg.password.trim() === PASSWORD) {
        authenticated = true;
        ws.send(JSON.stringify({ type: "authenticated" }));
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Invalid Password" }));
      }
      return;
    }

    if (!authenticated) return;

    // 2. Terminal Lifecycle
    if (msg.type === "spawn") {
      const { command, args = [], projectId, cols = 80, rows = 24 } = msg;

      // Persistence: Reuse existing session for this specific project/command combo
      sessionKey = `${projectId || "root"}-${command}`;

      if (!sessions.has(sessionKey)) {
        const cwd = projectId ? path.join(PROJECTS_DIR, projectId) : __dirname;

        const term = pty.spawn(command, args, {
          name: "xterm-color",
          cols: cols,
          rows: rows,
          cwd: cwd,
          env: { ...process.env, LANG: "en_US.UTF-8", TERM: "xterm-256color" },
        });

        sessions.set(sessionKey, { term, lastActive: Date.now() });

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data }));
          }
        });

        term.onExit(() => {
          sessions.delete(sessionKey);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "exit" }));
          }
        });
      } else {
        // Re-attach: Send clear screen and signal session is ready
        const existing = sessions.get(sessionKey);
        existing.lastActive = Date.now();
        // Force a redraw for the client
        existing.term.write("\x1b[L");
      }
      return;
    }

    // 3. Data Handling
    if (msg.type === "data" && sessionKey) {
      const session = sessions.get(sessionKey);
      if (session) session.term.write(msg.data);
    }

    if (msg.type === "resize" && sessionKey) {
      const session = sessions.get(sessionKey);
      if (session) session.term.resize(msg.cols, msg.rows);
    }
  });

  ws.on("close", () => {
    // We don't kill the terminal on close to allow persistence
    if (sessionKey && sessions.has(sessionKey)) {
      sessions.get(sessionKey).lastActive = Date.now();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
  console.log(`Password protection active.`);
});
