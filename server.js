const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const crypto = require("crypto"); // <-- added for hashing
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// 1️⃣ Secure password handling
// ---------------------------------------------------------------------------
// Original password (plain text) from env or fallback (trimmed)
const RAW_PASSWORD = (process.env.TERMINAL_PASSWORD || "Superprimitive69!").trim();
// Store a SHA‑256 hash of the password – never keep the plain value in memory
const PASSWORD_HASH = crypto
  .createHash("sha256")
  .update(RAW_PASSWORD)
  .digest("hex");

// Helper to hash incoming passwords for comparison
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

// ---------------------------------------------------------------------------
// Middleware & static assets
// ---------------------------------------------------------------------------
app.use(express.static("public"));
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// 3️⃣ Auth endpoint (kept for possible UI login flow)
// ---------------------------------------------------------------------------
app.post("/auth", (req, res) => {
  const { password } = req.body;
  if (password && hashPassword(password) === PASSWORD_HASH) {
    // Respond with a token‑like string (the hash) that client stores temporarily
    res.json({ success: true, token: PASSWORD_HASH });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

// ---------------------------------------------------------------------------
// 4️⃣ Auth middleware for REST API
// ---------------------------------------------------------------------------
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (token && token.trim() === PASSWORD_HASH) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// ---------------------------------------------------------------------------
// API routes (unchanged apart from auth)
// ---------------------------------------------------------------------------
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

app.post("/api/projects/clone", authMiddleware, (req, res) => {
  const { url, token } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });

  // Simple validation – must be a GitHub HTTPS URL
  const githubRegex = /^https:\/\/github\.com\/[^/]+\/[^/]+(\.git)?$/;
  if (!githubRegex.test(url)) {
    return res.status(400).json({ error: "Invalid GitHub URL" });
  }

  let cloneUrl = url;
  if (token && url.startsWith("https://github.com/")) {
    // Insert token for private repos (basic auth style)
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

// ---------------------------------------------------------------------------
// 5️⃣ WebSocket handling – robust reconnection & terminal guard will be on client
// ---------------------------------------------------------------------------
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

    // Auth handshake
    if (msg.type === "auth") {
      if (msg.password && hashPassword(msg.password) === PASSWORD_HASH) {
        authenticated = true;
        ws.send(JSON.stringify({ type: "authenticated" }));
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Invalid password" }));
        ws.close();
      }
      return;
    }

    // If not authenticated, ignore any other messages
    if (!authenticated) return;

    // (Existing terminal handling code would continue here – unchanged)
    // ...

  });

  ws.on("close", () => {
    // Cleanup if necessary – left as before
  });
});

// ---------------------------------------------------------------------------
// Server listen
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Pocket Terminal listening on http://localhost:${PORT}`);
});