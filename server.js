const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// 1️⃣ Secure password handling
// ---------------------------------------------------------------------------
const RAW_PASSWORD = (process.env.TERMINAL_PASSWORD || "Superprimitive69!").trim();
if (process.env.TERMINAL_PASSWORD === undefined) {
  console.warn("⚠️ WARNING: TERMINAL_PASSWORD not set. Using default fallback.");
}

const PASSWORD_HASH = crypto
  .createHash("sha256")
  .update(RAW_PASSWORD)
  .digest("hex");

function hashPassword(pwd) {
  return crypto.createHash("sha256").update(pwd.trim()).digest("hex");
}

// ---------------------------------------------------------------------------
// 2️⃣ Project directory setup
// ---------------------------------------------------------------------------
const PROJECTS_DIR = path.join(__dirname, "projects");
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static("public"));
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// 3️⃣ Auth endpoint
// ---------------------------------------------------------------------------
app.post("/auth", (req, res) => {
  const { password } = req.body;
  if (password && hashPassword(password) === PASSWORD_HASH) {
    // Return the hash as the session token
    res.json({ success: true, token: PASSWORD_HASH });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (token && token.trim() === PASSWORD_HASH) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// ---------------------------------------------------------------------------
// 4️⃣ API routes
// ---------------------------------------------------------------------------
app.get("/api/projects", authMiddleware, (req, res) => {
  try {
    const folders = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: "Failed to list projects" });
  }
});

app.post("/api/clone", authMiddleware, (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ error: "Repo URL required" });

  const folderName = repoUrl.split("/").pop().replace(".git", "");
  const targetDir = path.join(PROJECTS_DIR, folderName);

  exec(`git clone ${repoUrl} ${targetDir}`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, folderName });
  });
});

// ---------------------------------------------------------------------------
// 5️⃣ Terminal logic (WebSocket)
// ---------------------------------------------------------------------------
wss.on("connection", (ws) => {
  let shell = null;
  let authenticated = false;

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    // Auth check
    if (data.type === "auth") {
      if (data.token === PASSWORD_HASH) {
        authenticated = true;
        ws.send(JSON.stringify({ type: "authenticated" }));
        return;
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Invalid session" }));
        ws.close();
        return;
      }
    }

    if (!authenticated) return;

    // Terminal Commands
    if (data.type === "terminal_input") {
      if (shell) shell.write(data.data);
    } else if (data.type === "spawn") {
      if (shell) shell.kill();

      const workingDir = data.project 
        ? path.join(PROJECTS_DIR, data.project) 
        : PROJECTS_DIR;

      shell = pty.spawn(process.platform === "win32" ? "powershell.exe" : "bash", [], {
        name: "xterm-color",
        cols: data.cols || 80,
        rows: data.rows || 24,
        cwd: workingDir,
        env: process.env,
      });

      shell.onData((output) => {
        ws.send(JSON.stringify({ type: "terminal_output", data: output }));
      });

      shell.onExit(() => {
        ws.send(JSON.stringify({ type: "terminal_exit" }));
        shell = null;
      });
    } else if (data.type === "resize") {
      if (shell) shell.resize(data.cols, data.rows);
    }
  });

  ws.on("close", () => {
    if (shell) shell.kill();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Pocket Terminal running on port ${PORT}`);
});