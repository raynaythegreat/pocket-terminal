require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const { WebSocketServer, WebSocket } = require("ws");
const pty = require("node-pty");

const {
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  cleanupExpiredSessions,
  buildPasswordConfig,
} = require("./auth");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3000;

const { mode: PASSWORD_MODE, passwordHash: PASSWORD_HASH } = buildPasswordConfig(
  {
    TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  },
  console,
);

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const SESS_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const sessions = new Map(); // token -> { expiresAt }
const deviceTokens = new Map(); // deviceToken -> { expiresAt }

setInterval(() => {
  const cleaned = cleanupExpiredSessions(sessions);
  if (cleaned > 0) console.log(`Cleaned ${cleaned} sessions`);
}, SESS_CLEANUP_INTERVAL_MS).unref?.();

const CLI_HOME_DIR = path.resolve(__dirname, process.env.CLI_HOME_DIR || path.join("workspace", "cli-home"));
const WORKSPACE_DIR = path.resolve(__dirname, process.env.WORKSPACE_DIR || path.join("workspace", "projects"));
const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

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

function getClientIp(req) {
  const f = req.headers["x-forwarded-for"];
  if (typeof f === "string" && f.trim()) return f.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// simple login limiter
const loginLimiter = new Map();
const LOGIN_WINDOW_MS = 2 * 60 * 1000;
const LOGIN_MAX = 20;
function isRateLimited(ip) {
  const entry = loginLimiter.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { loginLimiter.delete(ip); return false; }
  return entry.count >= LOGIN_MAX;
}
function recordFailed(ip) {
  const now = Date.now();
  const e = loginLimiter.get(ip);
  if (!e || now > e.resetAt) loginLimiter.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else e.count++;
}
function clearAttempts(ip) { loginLimiter.delete(ip); }

function setAuthCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000) * 1000;
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge });
}
function clearAuthCookie(res) { res.clearCookie("token"); }

function getTokenFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) if (p.startsWith("token=")) return p.slice("token=".length);
  return null;
}

function isValidDeviceToken(t) {
  if (!t) return false;
  const e = deviceTokens.get(t);
  if (!e) return false;
  if (Date.now() > e.expiresAt) { deviceTokens.delete(t); return false; }
  return true;
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token || getTokenFromCookieHeader(req.headers.cookie || "");
  if (!isValidSession(sessions, token)) return res.status(401).json({ error: "invalid_session" });
  next();
}

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

// Login with password; optional remember flag
app.post(["/auth", "/auth/login"], (req, res) => {
  if (PASSWORD_MODE === "misconfigured") return res.status(500).json({ error: "server_misconfigured" });
  const ip = getClientIp(req);
  if (isRateLimited(ip)) return res.status(429).json({ error: "rate_limited" });

  const password = String(req.body && req.body.password ? req.body.password : "").trim();
  if (!password) { recordFailed(ip); return res.status(400).json({ error: "password_required" }); }
  if (!verifyPassword(password, PASSWORD_HASH)) { recordFailed(ip); return res.status(401).json({ error: "invalid_password" }); }

  clearAttempts(ip);
  const token = createSession(sessions, SESSION_TTL_MS);
  setAuthCookie(res, token);

  if (req.body && req.body.remember) {
    const devToken = require("crypto").randomBytes(24).toString("hex");
    const devTtl = 30 * 24 * 60 * 60 * 1000; // 30 days
    deviceTokens.set(devToken, { expiresAt: Date.now() + devTtl });
    res.cookie("device", devToken, { httpOnly: true, sameSite: "lax", maxAge: devTtl });
  }

  return res.json({ success: true, token });
});

// Device-based login: exchanges an existing device cookie for a session cookie
app.post("/auth/device", (req, res) => {
  const device = req.cookies?.device || getTokenFromCookieHeader(req.headers.cookie || "");
  if (!device || !isValidDeviceToken(device)) return res.status(401).json({ error: "invalid_device" });
  const token = createSession(sessions, SESSION_TTL_MS);
  setAuthCookie(res, token);
  return res.json({ success: true, token });
});

app.post("/auth/logout", (req, res) => {
  const token = req.cookies?.token || getTokenFromCookieHeader(req.headers.cookie || "");
  revokeSession(sessions, token);
  clearAuthCookie(res);
  // optionally forget device when requested
  if (req.body && req.body.forget && req.cookies?.device) {
    deviceTokens.delete(req.cookies.device);
    res.clearCookie("device");
  }
  return res.json({ success: true });
});

app.get("/api/tools", requireAuth, (req, res) => {
  const env = { ...process.env };
  const tools = Object.values(TOOL_CONFIG).map((tool) => ({ id: tool.id, title: tool.title, available: isToolAvailable(tool, env) }));
  res.json(tools);
});

function isToolAvailable(tool, env) {
  if (!tool || !tool.command) return false;
  if (tool.id === "shell") return true;
  const pathDirs = [LOCAL_BIN_DIR, NODE_BIN_DIR, ...(process.env.PATH || "").split(path.delimiter)];
  for (const dir of pathDirs) {
    try { if (dir && fs.existsSync(path.join(dir, tool.command + (process.platform === "win32" ? ".exe" : "")))) return true; } catch {}
  }
  return false;
}

// WebSocket PTY handling with persistent PTY per session token and buffered scrollback
const activeConnections = new Map(); // token -> { ws, pty, buffer }

function sendJson(ws, payload) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }

wss.on("connection", (ws, req) => {
  // authenticate via cookie token
  const cookieHeader = req.headers.cookie || "";
  let token = getTokenFromCookieHeader(cookieHeader) || req.cookies?.token;
  const deviceCookie = req.cookies?.device || (cookieHeader || "").split(";").map((p) => p.trim()).find((p) => p.startsWith("device="));
  const deviceValue = deviceCookie ? deviceCookie.slice("device=".length) : null;

  if (!isValidSession(sessions, token)) {
    if (isValidDeviceToken(deviceValue)) {
      token = createSession(sessions, SESSION_TTL_MS);
      // note: client-side should call /auth/device to get an HTTP cookie for session if desired
    } else {
      sendJson(ws, { type: "error", message: "unauthorized" });
      ws.close(1008, "unauthorized");
      return;
    }
  }

  const conn = activeConnections.get(token) || { ws: null, pty: null, buffer: "" };
  conn.ws = ws;
  activeConnections.set(token, conn);

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    let msg = null;
    try { msg = JSON.parse(text); } catch {}
    if (!msg || !msg.type) return sendJson(ws, { type: "error", message: "invalid_message" });

    if (msg.type === "launch") {
      const toolId = (msg.tool || "shell").trim();
      const tool = TOOL_CONFIG[toolId];
      if (!tool) return sendJson(ws, { type: "error", message: `unknown_tool:${toolId}` });
      if (!isToolAvailable(tool, process.env)) return sendJson(ws, { type: "error", message: `tool_unavailable:${toolId}` });

      // if a pty already exists for this token, treat as reattach and don't spawn
      if (conn.pty) {
        // send buffered output and indicate reattached
        if (conn.buffer && conn.buffer.length > 0) sendJson(ws, { type: "data", data: conn.buffer });
        sendJson(ws, { type: "launched", tool: toolId, reattach: true });
        return;
      }

      try {
        const cols = Number(msg.cols) || 80;
        const rows = Number(msg.rows) || 24;
        const env = { ...process.env, HOME: CLI_HOME_DIR, CLI_HOME: CLI_HOME_DIR, WORKSPACE_DIR, PATH: [LOCAL_BIN_DIR, NODE_BIN_DIR, process.env.PATH].join(path.delimiter), TERM: "xterm-256color", COLORTERM: "truecolor" };
        const p = pty.spawn(tool.command, tool.args || [], { name: "xterm-256color", cols, rows, cwd: WORKSPACE_DIR, env });
        conn.pty = p;
        conn.buffer = conn.buffer || "";
        const MAX_BUFFER = 128 * 1024;

        p.onData((d) => {
          conn.buffer += d;
          if (conn.buffer.length > MAX_BUFFER) conn.buffer = conn.buffer.slice(-MAX_BUFFER);
          sendJson(ws, { type: "data", data: d });
        });

        p.onExit(({ exitCode }) => {
          sendJson(ws, { type: "exit", exitCode });
          conn.pty = null;
        });

        // send buffered output if any (reattach case)
        if (conn.buffer && conn.buffer.length > 0) sendJson(ws, { type: "data", data: conn.buffer });
        sendJson(ws, { type: "launched", tool: toolId });
      } catch (err) {
        console.error("launch error", err);
        sendJson(ws, { type: "error", message: "launch_failed" });
      }
    } else if (msg.type === "data") {
      if (conn.pty && typeof msg.data === "string") {
        try { conn.pty.write(msg.data); } catch (err) { console.error(err); }
      }
    } else if (msg.type === "resize") {
      if (conn.pty && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        try { conn.pty.resize(msg.cols, msg.rows); } catch (err) { console.error(err); }
      }
    } else if (msg.type === "ping") {
      sendJson(ws, { type: "pong" });
    }
  });

  ws.on("close", () => {
    // keep pty alive for reattach
    conn.ws = null;
    activeConnections.set(token, conn);
  });

  ws.on("error", (err) => {
    console.error("ws error", err);
    conn.ws = null;
  });
});

// graceful shutdown: kill all pties
process.on("SIGTERM", () => {
  for (const c of activeConnections.values()) try { if (c.pty) c.pty.kill(); } catch {}
  server.close();
});
process.on("SIGINT", () => {
  for (const c of activeConnections.values()) try { if (c.pty) c.pty.kill(); } catch {}
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Password mode: ${PASSWORD_MODE}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`CLI Home: ${CLI_HOME_DIR}`);
});
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const pty = require("node-pty");

const {
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  cleanupExpiredSessions,
  buildPasswordConfig,
} = require("./auth");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3000;

const { mode: PASSWORD_MODE, passwordHash: PASSWORD_HASH } = buildPasswordConfig(
  {
    TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  },
  console,
);

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const sessions = new Map(); // token -> { expiresAt }
const deviceTokens = new Map(); // deviceToken -> { expiresAt }

setInterval(() => {
  const cleaned = cleanupExpiredSessions(sessions);
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions. Active sessions: ${sessions.size}`);
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref?.();

const CLI_HOME_DIR = path.resolve(
  __dirname,
  process.env.CLI_HOME_DIR || path.join("workspace", "cli-home"),
);

const WORKSPACE_DIR = path.resolve(
  __dirname,
  process.env.WORKSPACE_DIR || path.join("workspace", "projects"),
);

const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

for (const dir of [CLI_HOME_DIR, WORKSPACE_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Tool configuration
const TOOL_CONFIG = {
  shell: {
    id: "shell",
    title: "Shell",
    command: process.platform === "win32" ? "cmd.exe" : "bash",
    args: [],
  },
  gh: { id: "gh", title: "GitHub CLI", command: "gh", args: [] },
  copilot: { id: "copilot", title: "Copilot", command: "github-copilot-cli", args: [] },
  gemini: { id: "gemini", title: "Gemini", command: "gemini-cli", args: [] },
  gcloud: { id: "gcloud", title: "gcloud", command: "gcloud", args: [] },
  opencode: { id: "opencode", title: "opencode", command: "opencode", args: [] },
  kimi: { id: "kimi", title: "kimi", command: "kimi", args: [] },
};

app.use(express.json({ limit: "1mb" }));
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
    etag: true,
  }),
);

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Basic login rate limiting
const loginLimiter = new Map(); // ip -> { count, resetAt }
const LOGIN_WINDOW_MS = 2 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const entry = loginLimiter.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginLimiter.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    loginLimiter.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearAttempts(ip) {
  loginLimiter.delete(ip);
}

function setAuthCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: maxAge * 1000 });
}

function clearAuthCookie(res) {
  res.clearCookie("token");
}

function getTokenFromRequest(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  // check cookie
  const cookie = req.headers.cookie || "";
  return getTokenFromCookieHeader(cookie);
}

function getTokenFromCookieHeader(cookieHeader) {
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith("token=")) return p.slice("token=".length);
  }
  return null;
}

function isValidDeviceToken(devToken) {
  if (!devToken) return false;
  const entry = deviceTokens.get(devToken);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    deviceTokens.delete(devToken);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!isValidSession(sessions, token)) return res.status(401).json({ error: "invalid_session" });
  next();
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

// Authentication handler used for both /auth and /auth/login
function handleAuthPost(req, res) {
  if (PASSWORD_MODE === "misconfigured") {
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  const password = String(req.body && req.body.password ? req.body.password : "").trim();
  if (!password) {
    recordFailedAttempt(ip);
    return res.status(400).json({ error: "password_required" });
  }

  if (!verifyPassword(password, PASSWORD_HASH)) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: "invalid_password" });
  }

  clearAttempts(ip);
  const token = createSession(sessions, SESSION_TTL_MS);
  setAuthCookie(res, token);
  // If client asked to remember device, create a long-lived device token
  try {
    if (req.body && req.body.remember) {
      const devToken = require("crypto").randomBytes(24).toString("hex");
      const devTtl = 30 * 24 * 60 * 60 * 1000; // 30 days
      deviceTokens.set(devToken, { expiresAt: Date.now() + devTtl });
      res.cookie("device", devToken, { httpOnly: true, sameSite: "lax", maxAge: devTtl });
    }
  } catch (e) {}
  return res.json({ success: true, token });
}

app.post("/auth", handleAuthPost);
app.post("/auth/login", handleAuthPost);

app.post("/auth/logout", (req, res) => {
  const token = getTokenFromRequest(req);
  revokeSession(sessions, token);
  clearAuthCookie(res);
  return res.json({ success: true });
});

// Tool availability helpers
function isToolAvailable(tool, env) {
  if (!tool || !tool.command) return false;
  if (tool.id === "shell") return true;

  const pathDirs = [LOCAL_BIN_DIR, NODE_BIN_DIR, ...(process.env.PATH || "").split(path.delimiter)];
  for (const dir of pathDirs) {
    const full = path.join(dir || "", tool.command + (process.platform === "win32" ? ".exe" : ""));
    try {
      if (full && fs.existsSync(full)) return true;
    } catch {}
  }

  // common alternates
  const alternates = {
    "github-copilot-cli": ["gh-copilot", "copilot", "github-copilot"],
    "gemini-cli": ["gemini", "gcloud"],
    "opencode": ["opencode", "oc"],
  };
  const alts = alternates[tool.command];
  if (alts) {
    for (const alt of alts) {
      for (const dir of pathDirs) {
        const full = path.join(dir || "", alt + (process.platform === "win32" ? ".exe" : ""));
        try { if (full && fs.existsSync(full)) return true; } catch {}
      }
    }
  }

  return false;
}

app.get("/api/tools", requireAuth, (req, res) => {
  const env = { ...process.env };
  const tools = Object.values(TOOL_CONFIG).map((tool) => ({
    id: tool.id,
    title: tool.title,
    available: isToolAvailable(tool, env),
  }));
  res.json(tools);
});

// WebSocket PTY handling
const activeConnections = new Map(); // token -> { ws, pty }

wss.on("connection", (ws, req) => {
  const token = getTokenFromCookieHeader(req.headers.cookie || "");
  if (!isValidSession(sessions, token)) {
    sendJson(ws, { type: "error", message: "Unauthorized. Please log in." });
    ws.close(1008, "unauthorized");
    return;
  }

  // keep a record, but pty is created on 'launch'
  activeConnections.set(token, { ws, pty: null });

  ws.on("message", (raw) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    let msg = null;
    try { msg = JSON.parse(text); } catch {}

    if (!msg || !msg.type) {
      sendJson(ws, { type: "error", message: "invalid_message" });
      return;
    }

    if (msg.type === "launch") {
      const toolId = (msg.tool || "shell").trim();
      const tool = TOOL_CONFIG[toolId];
      if (!tool) return sendJson(ws, { type: "error", message: `unknown_tool:${toolId}` });
      if (!isToolAvailable(tool, process.env)) return sendJson(ws, { type: "error", message: `tool_unavailable:${toolId}` });

      // kill existing
      const conn = activeConnections.get(token);
      if (conn?.pty) {
        try { conn.pty.kill(); } catch {}
        conn.pty = null;
      }

      try {
        const cols = Number(msg.cols) || 80;
        const rows = Number(msg.rows) || 24;
        const env = {
          ...process.env,
          HOME: CLI_HOME_DIR,
          CLI_HOME: CLI_HOME_DIR,
          WORKSPACE_DIR,
          PATH: [LOCAL_BIN_DIR, NODE_BIN_DIR, process.env.PATH].join(path.delimiter),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        };

        const p = pty.spawn(tool.command, tool.args || [], {
          name: "xterm-256color",
          cols,
          rows,
          cwd: WORKSPACE_DIR,
          env,
        });

        conn.pty = p;

        p.onData((d) => sendJson(ws, { type: "data", data: d }));
        p.onExit(({ exitCode }) => {
          sendJson(ws, { type: "exit", exitCode });
          conn.pty = null;
        });

        sendJson(ws, { type: "launched", tool: toolId });
      } catch (err) {
        console.error("launch error", err);
        sendJson(ws, { type: "error", message: "launch_failed" });
      }
    } else if (msg.type === "data") {
      const conn = activeConnections.get(token);
      if (conn?.pty && typeof msg.data === "string") {
        try { conn.pty.write(msg.data); } catch (err) { console.error(err); }
      }
    } else if (msg.type === "resize") {
      const conn = activeConnections.get(token);
      if (conn?.pty && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        try { conn.pty.resize(msg.cols, msg.rows); } catch (err) { console.error(err); }
      }
    } else if (msg.type === "ping") {
      sendJson(ws, { type: "pong" });
    }
  });

  ws.on("close", () => {
    const conn = activeConnections.get(token);
    if (conn) {
      try { if (conn.pty) conn.pty.kill(); } catch {}
      activeConnections.delete(token);
    }
  });
});

// graceful shutdown
process.on("SIGTERM", () => {
  for (const c of activeConnections.values()) { try { if (c.pty) c.pty.kill(); } catch {} }
  server.close();
});

process.on("SIGINT", () => {
  for (const c of activeConnections.values()) { try { if (c.pty) c.pty.kill(); } catch {} }
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Password mode: ${PASSWORD_MODE}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`CLI Home: ${CLI_HOME_DIR}`);
});

  term.onExit((evt) => {
    sendJson(ws, {
      type: "exit",
      exitCode: evt && typeof evt.exitCode === "number" ? evt.exitCode : 0,
    });
    try {
      ws.close(1000, "process exited");
    } catch {}
  });

  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString();

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      msg = null;
    }

    if (msg && msg.type === "resize") {
      const cols = clampInt(msg.cols, 20, 400, 80);
      const rows = clampInt(msg.rows, 5, 200, 24);
>>>>>>> 6739dae (fix: accept both /auth and /auth/login for backward compatibility)
      try {
        if (fs.existsSync(fullPath)) {
          return true;
        }
      } catch (error) {
        continue;
      }
    }
  }
  return false;
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  next();
}

// WebSocket handling
const activeConnections = new Map(); // token -> { ws, ptyProcess }

wss.on("connection", (ws, request) => {
  // Accept either a session token or a device token and create/attach session accordingly
  const cookieHeader = req.headers.cookie || "";
  let token = getTokenFromCookieHeader(cookieHeader);
  const deviceToken = (cookieHeader || "").split(";").map((p) => p.trim()).find((p) => p.startsWith("device="));
  const deviceValue = deviceToken ? deviceToken.slice("device=".length) : null;

  if (!isValidSession(sessions, token)) {
    // if device token valid, create a new session for this device
    if (isValidDeviceToken(deviceValue)) {
      token = createSession(sessions, SESSION_TTL_MS);
      // note: cannot set HTTP cookie over WS handshake; client should call /auth/device to get session cookie
    } else {
      sendJson(ws, { type: "error", message: "Unauthorized. Please log in." });
      ws.close(1008, "unauthorized");
      return;
    }
  }

  // keep a record, but pty is created on 'launch'; reuse existing connection object if present
  const existing = activeConnections.get(token) || { ws: null, pty: null, buffer: "" };
  existing.ws = ws;
  activeConnections.set(token, existing);
        handleDataMessage(ws, data);
      } else if (data.type === "resize") {
        handleResizeMessage(ws, data);
      } else if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({ 
        type: "error", 
        message: "Invalid message format" 
      }));
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    const connection = findConnectionByWs(ws);
    if (connection) {
      cleanupConnection(connection);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    const connection = findConnectionByWs(ws);
    if (connection) {
      cleanupConnection(connection);
    }
  });
});

async function handleAuthMessage(ws, data) {
  const { token } = data;
  
  if (!isValidSession(sessions, token)) {
    ws.send(JSON.stringify({ 
      type: "auth", 
      success: false, 
      error: "Invalid or expired session" 
    }));
    ws.close();
    return;
  }

  // Store the authenticated connection
  activeConnections.set(token, { ws, ptyProcess: null });
  
  ws.send(JSON.stringify({ 
    type: "auth", 
    success: true 
  }));
}

async function handleLaunchMessage(ws, data) {
  const { tool } = data;
  const connection = findConnectionByWs(ws);
  
  if (!connection) {
    ws.send(JSON.stringify({ 
      type: "error", 
      message: "Connection not authenticated" 
    }));
    return;
  }

  // Clean up existing process if any
  if (connection.ptyProcess) {
    try {
      connection.ptyProcess.kill();
    } catch (error) {
      console.warn("Error killing existing process:", error);
    }
  }

  const cliTool = CLI_TOOLS[tool];
  if (!cliTool) {
    ws.send(JSON.stringify({ 
      type: "error", 
      message: `Unknown tool: ${tool}` 
    }));
    return;
  }

  try {
    const env = {
      ...process.env,
      HOME: CLI_HOME_DIR,
      CLI_HOME: CLI_HOME_DIR,
      WORKSPACE_DIR,
      PATH: [
        LOCAL_BIN_DIR,
        NODE_BIN_DIR,
        process.env.PATH
      ].join(path.delimiter),
      TERM: "xterm-256color",
      COLORTERM: "truecolor"
    };

    const ptyProcess = pty.spawn(cliTool.command, cliTool.args, {
      name: "xterm-color",
      cols: data.cols || 80,
      rows: data.rows || 24,
      cwd: WORKSPACE_DIR,
      env,
      encoding: "utf8"
    });

    connection.ptyProcess = ptyProcess;

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: "exit", 
          exitCode, 
          signal 
        }));
      }
      connection.ptyProcess = null;
    });

    ws.send(JSON.stringify({ 
      type: "launched", 
      tool: cliTool.name 
    }));

  } catch (error) {
    console.error("Failed to launch tool:", error);
    ws.send(JSON.stringify({ 
      type: "error", 
      message: `Failed to launch ${cliTool.name}: ${error.message}` 
    }));
  }
}

function handleDataMessage(ws, data) {
  const connection = findConnectionByWs(ws);
  if (connection && connection.ptyProcess && data.data) {
    try {
      connection.ptyProcess.write(data.data);
    } catch (error) {
      console.error("Error writing to pty:", error);
    }
  }
}

function handleResizeMessage(ws, data) {
  const connection = findConnectionByWs(ws);
  if (connection && connection.ptyProcess && data.cols && data.rows) {
    try {
      connection.ptyProcess.resize(data.cols, data.rows);
    } catch (error) {
      console.error("Error resizing pty:", error);
    }
  }
}

function findConnectionByWs(ws) {
  for (const connection of activeConnections.values()) {
    if (connection.ws === ws) {
      return connection;
    }
  }
  return null;
}

function cleanupConnection(connection) {
  if (connection.ptyProcess) {
    try {
      connection.ptyProcess.kill();
    } catch (error) {
      console.warn("Error killing process during cleanup:", error);
    }
  }
  
  // Remove from activeConnections
  for (const [token, conn] of activeConnections.entries()) {
    if (conn === connection) {
      activeConnections.delete(token);
      break;
    }
  }
}

// Cleanup on server shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, cleaning up...");
  for (const connection of activeConnections.values()) {
    cleanupConnection(connection);
  }
  server.close();
});

process.on("SIGINT", () => {
  console.log("SIGINT received, cleaning up...");
  for (const connection of activeConnections.values()) {
    cleanupConnection(connection);
  }
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Password mode: ${PASSWORD_MODE}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`CLI Home: ${CLI_HOME_DIR}`);
});