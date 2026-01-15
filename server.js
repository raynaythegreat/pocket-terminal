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

const PASSWORD_HASH = crypto.createHash("sha256").update(RAW_PASSWORD).digest("hex");

function hashPassword(pwd) {
  return crypto.createHash("sha256").update(String(pwd || "").trim()).digest("hex");
}

// ---------------------------------------------------------------------------
// 1b️⃣ Session token handling (do NOT use PASSWORD_HASH as a token)
// ---------------------------------------------------------------------------
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7); // 7 days
const sessions = new Map(); // token -> { expiresAt: number }

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { expiresAt });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function revokeSession(token) {
  if (!token) return;
  sessions.delete(token);
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions.entries()) {
    if (now > entry.expiresAt) sessions.delete(token);
  }
}, 1000 * 60 * 15).unref();

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
// 3️⃣ Auth endpoints
// ---------------------------------------------------------------------------
app.post("/auth", (req, res) => {
  const { password } = req.body || {};
  if (password && hashPassword(password) === PASSWORD_HASH) {
    const token = createSession();
    res.json({ success: true, token, expiresInMs: SESSION_TTL_MS });
  } else {
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

app.post("/logout", (req, res) => {
  const token = String(req.headers.authorization || "").trim();
  if (token) revokeSession(token);
  res.json({ success: true });
});

const authMiddleware = (req, res, next) => {
  const token = String(req.headers.authorization || "").trim();
  if (isValidSession(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
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
  const { repoUrl } = req.body || {};
  if (!repoUrl) return res.status(400).json({ error: "Repo URL required" });

  const folderName = String(repoUrl).split("/").pop().replace(".git", "");
  const targetDir = path.join(PROJECTS_DIR, folderName);

  if (!folderName || folderName.includes("..") || folderName.includes("/") || folderName.includes("\\")) {
    return res.status(400).json({ error: "Invalid repo URL" });
  }

  if (fs.existsSync(targetDir)) {
    return res.status(409).json({ error: "Project already exists" });
  }

  exec(`git clone ${repoUrl} "${targetDir}"`, { cwd: PROJECTS_DIR }, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr || stdout || err);
      return res.status(500).json({ error: "Clone failed" });
    }
    res.json({ success: true, folder: folderName });
  });
});

// ---------------------------------------------------------------------------
// 5️⃣ WebSocket: authenticated PTY sessions
// ---------------------------------------------------------------------------
function safeCwd(projectName) {
  if (!projectName) return __dirname;
  const cleaned = String(projectName);
  if (cleaned.includes("..") || cleaned.includes("/") || cleaned.includes("\\")) return __dirname;
  const p = path.join(PROJECTS_DIR, cleaned);
  if (!p.startsWith(PROJECTS_DIR)) return __dirname;
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return __dirname;
  return p;
}

wss.on("connection", (ws) => {
  ws.isAuthed = false;
  ws.ptyProcess = null;

  const killPty = () => {
    try {
      if (ws.ptyProcess) ws.ptyProcess.kill();
    } catch (_) {
      // ignore
    } finally {
      ws.ptyProcess = null;
    }
  };

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (e) {
      return;
    }

    // Require explicit auth first
    if (!ws.isAuthed) {
      if (msg && msg.type === "auth") {
        const token = String(msg.token || "").trim();
        if (!isValidSession(token)) {
          try {
            ws.send(JSON.stringify({ type: "auth_failed" }));
          } catch (_) {}
          ws.close(1008, "Unauthorized");
          return;
        }
        ws.isAuthed = true;
        ws.sessionToken = token;
        try {
          ws.send(JSON.stringify({ type: "auth_ok" }));
        } catch (_) {}
        return;
      }

      // Any other message before auth => reject
      try {
        ws.send(JSON.stringify({ type: "auth_required" }));
      } catch (_) {}
      ws.close(1008, "Auth required");
      return;
    }

    // After auth: allow terminal start/input/resize
    if (msg.type === "start") {
      const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
      const cwd = safeCwd(msg.project);

      killPty();
      ws.ptyProcess = pty.spawn(shell, [], {
        name: "xterm-color",
        cols: Number(msg.cols || 80),
        rows: Number(msg.rows || 24),
        cwd,
        env: process.env,
      });

      ws.ptyProcess.onData((data) => {
        try {
          ws.send(JSON.stringify({ type: "data", data }));
        } catch (_) {
          // ignore
        }
      });

      ws.ptyProcess.onExit(() => {
        try {
          ws.send(JSON.stringify({ type: "exit" }));
        } catch (_) {
          // ignore
        }
        killPty();
      });

      return;
    }

    if (msg.type === "input" && ws.ptyProcess) {
      ws.ptyProcess.write(String(msg.data || ""));
      return;
    }

    if (msg.type === "resize" && ws.ptyProcess) {
      const cols = Number(msg.cols || 80);
      const rows = Number(msg.rows || 24);
      try {
        ws.ptyProcess.resize(cols, rows);
      } catch (_) {
        // ignore
      }
      return;
    }
  });

  ws.on("close", () => {
    try {
      if (ws.ptyProcess) ws.ptyProcess.kill();
    } catch (_) {
      // ignore
    }
  });

  ws.on("error", () => {
    // Keep server stable
  });
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
});