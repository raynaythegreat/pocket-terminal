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
          "Authentication is not configured. Admin must set TERMINAL_PASSWORD.",
      });
    }

    if (!req.body || typeof req.body.password !== "string") {
      return res.status(400).json({
        success: false,
        error: "invalid_request",
        message: "Password is required.",
      });
    }

    const { password } = req.body;

    if (!verifyPassword(password, PASSWORD_HASH)) {
      return res.status(401).json({
        success: false,
        error: "invalid_password",
        message: "Invalid password.",
      });
    }

    const token = createNewSession();

    return res.json({
      success: true,
      token,
      sessionTtlMs: SESSION_TTL_MS,
    });
  } catch (err) {
    console.error("Error in /auth:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error.",
    });
  }
});

app.post("/auth/logout", (req, res) => {
  try {
    const token = getBearerToken(req) || (req.body && req.body.token) || null;
    if (token) {
      revokeSessionToken(token);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Error in /auth/logout:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error.",
    });
  }
});

app.get("/auth/status", (req, res) => {
  try {
    const nodeEnv = process.env.NODE_ENV || "development";
    const isProd = nodeEnv === "production";

    const payload = {
      authConfigured: PASSWORD_MODE !== "misconfigured",
    };

    // In non-production we can expose more detailed mode info for diagnostics.
    if (!isProd) {
      payload.mode = PASSWORD_MODE;
    }

    return res.json(payload);
  } catch (err) {
    console.error("Error in /auth/status:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error.",
    });
  }
});

// ---------------------------------------------------------------------------
// WebSocket + PTY handling
// ---------------------------------------------------------------------------
wss.on("connection", (ws, req) => {
  // Extract token from query string: ws://...?token=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!isSessionValid(token)) {
    ws.close(4001, "unauthorized");
    return;
  }

  // Spawn a shell
  const shell =
    process.env.SHELL ||
    (process.platform === "win32" ? "powershell.exe" : "bash");

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: PROJECTS_DIR,
    env: process.env,
  });

  ptyProcess.on("data", (data) => {
    try {
      ws.send(data);
    } catch (err) {
      console.error("Error sending data over WS:", err);
    }
  });

  ws.on("message", (msg) => {
    try {
      const text =
        typeof msg === "string" ? msg : Buffer.from(msg).toString("utf8");
      // Support resize messages: {"type":"resize","cols":n,"rows":m}
      try {
        const parsed = JSON.parse(text);
        if (
          parsed &&
          parsed.type === "resize" &&
          Number.isInteger(parsed.cols) &&
          Number.isInteger(parsed.rows)
        ) {
          ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON; treat as regular input
      }

      ptyProcess.write(text);
    } catch (err) {
      console.error("Error handling WS message:", err);
    }
  });

  ws.on("close", () => {
    try {
      ptyProcess.kill();
    } catch (err) {
      console.error("Error killing PTY on WS close:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    try {
      ptyProcess.kill();
    } catch (e) {
      console.error("Error killing PTY on WS error:", e);
    }
  });
});

// ---------------------------------------------------------------------------
// API routes (example protected route)
// ---------------------------------------------------------------------------
app.get("/projects", requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) {
      return res.json({ success: true, projects: [] });
    }

    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
    const projects = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    res.json({ success: true, projects });
  } catch (err) {
    console.error("Error in /projects:", err);
    res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error.",
    });
  }
});

// ---------------------------------------------------------------------------
// Static file handling + server start
// ---------------------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal listening on http://localhost:${PORT}`);
});