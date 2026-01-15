const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const {
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  buildPasswordConfig,
} = require("./auth");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Password + auth configuration
// ---------------------------------------------------------------------------
const { mode: PASSWORD_MODE, passwordHash: PASSWORD_HASH } = buildPasswordConfig(
  {
    TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  },
  console
);

// ---------------------------------------------------------------------------
// Session token handling
// ---------------------------------------------------------------------------
const SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7
); // 7 days
const sessions = new Map(); // token -> { expiresAt: number }

function createNewSession() {
  return createSession(sessions, SESSION_TTL_MS);
}

function isSessionValid(token) {
  return isValidSession(sessions, token);
}

function revokeSessionToken(token) {
  revokeSession(sessions, token);
}

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions.entries()) {
    if (now > entry.expiresAt) sessions.delete(token);
  }
}, 1000 * 60 * 15).unref();

// ---------------------------------------------------------------------------
// Project directory setup
// ---------------------------------------------------------------------------
const PROJECTS_DIR = path.join(__dirname, "projects");
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static("public"));
app.use(express.json({ limit: "1mb" }));

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, value] = header.split(" ");
  if (scheme && scheme.toLowerCase() === "bearer" && value) return value.trim();
  return null;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!isSessionValid(token)) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  req.sessionToken = token;
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post("/auth", (req, res) => {
  try {
    if (PASSWORD_MODE === "misconfigured") {
      // In production with no TERMINAL_PASSWORD set.
      return res.status(503).json({
        success: false,
        error: "server_misconfigured",
        message:
          "Authentication is not configured correctly on the server. TERMINAL_PASSWORD must be set.",
      });
    }

    const { password } = req.body || {};
    if (typeof password !== "string" || password.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "invalid_request", message: "Password is required." });
    }

    if (!PASSWORD_HASH) {
      // Should not happen in non-misconfigured modes, but guard just in case.
      console.error("PASSWORD_HASH is missing despite PASSWORD_MODE =", PASSWORD_MODE);
      return res.status(500).json({
        success: false,
        error: "internal_error",
        message: "Authentication system is not available.",
      });
    }

    const ok = verifyPassword(password, PASSWORD_HASH);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, error: "invalid_password", message: "Invalid password." });
    }

    const token = createNewSession();
    return res.json({ success: true, token });
  } catch (err) {
    console.error("Error in /auth:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Unexpected error during authentication.",
    });
  }
});

app.get("/auth/status", (req, res) => {
  try {
    const authConfigured = PASSWORD_MODE !== "misconfigured";
    const isProd = (process.env.NODE_ENV || "development") === "production";

    const payload = { authConfigured };
    if (!isProd) {
      // In non-production we can safely expose the mode to help debugging
      payload.mode = PASSWORD_MODE;
    }

    res.json(payload);
  } catch (err) {
    console.error("Error in /auth/status:", err);
    res.status(500).json({ authConfigured: false });
  }
});

// ---------------------------------------------------------------------------
// Terminal WebSocket + PTY
// ---------------------------------------------------------------------------

function getProjectCwd(projectName) {
  if (!projectName) return process.cwd();
  const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  return path.join(PROJECTS_DIR, safeName);
}

wss.on("connection", (ws, req) => {
  // Expect ?token=...&project=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const project = url.searchParams.get("project") || "";

  if (!isSessionValid(token)) {
    ws.close(1008, "unauthorized");
    return;
  }

  const cwd = getProjectCwd(project);

  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }

  // Spawn shell
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd,
    env: process.env,
  });

  ws.on("message", (msg) => {
    try {
      const data = msg.toString();
      ptyProcess.write(data);
    } catch (err) {
      console.error("Error handling WS message:", err);
    }
  });

  ptyProcess.onData((data) => {
    try {
      ws.send(data);
    } catch (err) {
      console.error("Error sending WS data:", err);
    }
  });

  ws.on("close", () => {
    try {
      ptyProcess.kill();
    } catch (err) {
      console.error("Error killing PTY on close:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    try {
      ptyProcess.kill();
    } catch (_) {
      // ignore
    }
  });
});

// ---------------------------------------------------------------------------
// API routes for project management (authenticated)
// ---------------------------------------------------------------------------

app.get("/projects", requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) {
      return res.json({ projects: [] });
    }
    const dirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    res.json({ projects: dirs });
  } catch (err) {
    console.error("Error listing projects:", err);
    res.status(500).json({ projects: [] });
  }
});

app.post("/projects", requireAuth, (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "invalid_request", message: "Project name is required." });
    }
    const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
    const dir = path.join(PROJECTS_DIR, safeName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    res.json({ success: true, name: safeName });
  } catch (err) {
    console.error("Error creating project:", err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`Pocket Terminal server running on port ${PORT}`);
});