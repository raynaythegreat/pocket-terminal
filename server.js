const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Secure password handling
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
// Session token handling
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
  if (!isValidSession(token)) return res.status(401).json({ success: false, error: "unauthorized" });
  req.sessionToken = token;
  next();
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------
app.post("/auth", (req, res) => {
  const { password } = req.body || {};
  if (password && hashPassword(password) === PASSWORD_HASH) {
    const token = createSession();
    return res.json({ success: true, token, expiresInMs: SESSION_TTL_MS });
  }
  return res.status(401).json({ success: false, error: "invalid_password" });
});

app.post("/logout", requireAuth, (req, res) => {
  revokeSession(req.sessionToken);
  res.json({ success: true });
});

app.get("/me", (req, res) => {
  const token = getBearerToken(req);
  if (!isValidSession(token)) return res.status(401).json({ success: false });
  return res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Utility: nice error text when tool isn't installed
// ---------------------------------------------------------------------------
function missingToolHelp(cmd) {
  const lines = [];
  lines.push("");
  lines.push("Pocket Terminal: command not available on this server.");
  lines.push(`Requested: ${cmd}`);
  lines.push("");
  lines.push("This deployment uses 'best effort' optional installs for AI CLIs to avoid build failures.");
  lines.push("If you want this tool available here, install it in the environment, e.g.:");
  lines.push("");
  lines.push(`  npm i -g ${cmd}`);
  lines.push("  # or add the package back into dependencies and redeploy (may fail if GitHub downloads are blocked).");
  lines.push("");
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// WebSocket Terminal handling
// Protocol:
// - client sends: {"type":"auth","token":"..."} first
// - server replies: {"type":"auth_ok"} or {"type":"auth_failed"}
// - client sends: {"type":"start","cmd":"bash","args":[],"cwd":""}
// - server replies: {"type":"data","data":"..."} / {"type":"exit","code":0}
// ---------------------------------------------------------------------------
wss.on("connection", (ws) => {
  let authed = false;
  let term = null;

  function safeSend(obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (_) {
      // ignore
    }
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (_) {
      return;
    }

    if (!authed) {
      if (msg && msg.type === "auth") {
        if (isValidSession(msg.token)) {
          authed = true;
          safeSend({ type: "auth_ok" });
        } else {
          safeSend({ type: "auth_failed" });
          try {
            ws.close(4001, "unauthorized");
          } catch (_) {}
        }
      }
      return;
    }

    if (msg && msg.type === "start") {
      if (term) {
        try {
          term.kill();
        } catch (_) {}
        term = null;
      }

      const cmd = String(msg.cmd || "").trim();
      const args = Array.isArray(msg.args) ? msg.args.map((a) => String(a)) : [];
      const cwd = msg.cwd ? path.resolve(PROJECTS_DIR, String(msg.cwd)) : PROJECTS_DIR;

      if (!cmd) {
        safeSend({ type: "data", data: "\r\nMissing command.\r\n" });
        return;
      }

      try {
        term = pty.spawn(cmd, args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env: process.env,
        });
      } catch (err) {
        // Common case: ENOENT (binary missing)
        const code = err && err.code ? String(err.code) : "SPAWN_ERROR";
        const message =
          code === "ENOENT"
            ? missingToolHelp(cmd)
            : `\r\nPocket Terminal: failed to start command.\r\n${cmd}\r\nError: ${String(
                err && err.message ? err.message : err
              )}\r\n`;
        safeSend({ type: "data", data: message });
        safeSend({ type: "exit", code: 127 });
        return;
      }

      term.onData((data) => safeSend({ type: "data", data }));
      term.onExit(({ exitCode }) => {
        safeSend({ type: "exit", code: exitCode });
        term = null;
      });

      return;
    }

    if (msg && msg.type === "data" && term) {
      try {
        term.write(String(msg.data || ""));
      } catch (_) {}
      return;
    }

    if (msg && msg.type === "resize" && term) {
      const cols = Number(msg.cols || 0);
      const rows = Number(msg.rows || 0);
      if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
        try {
          term.resize(cols, rows);
        } catch (_) {}
      }
      return;
    }
  });

  ws.on("close", () => {
    if (term) {
      try {
        term.kill();
      } catch (_) {}
      term = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on port ${PORT}`);
});