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

const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

for (const dir of [CLI_HOME_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildPtyEnv() {
  const mergedPath = [NODE_BIN_DIR, LOCAL_BIN_DIR, __dirname, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);

  return {
    ...process.env,
    HOME: CLI_HOME_DIR,
    PATH: mergedPath,
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
}

function resolveCommand(command, env) {
  if (!command) return null;
  if (command.includes(path.sep)) {
    return isExecutable(command) ? command : null;
  }

  const pathValue = (env && env.PATH) || process.env.PATH || "";
  for (const dir of String(pathValue).split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function getTokenFromCookieHeader(cookieHeader) {
  const cookieValue = cookieHeader || "";
  const cookies = cookieValue.split(";").map((c) => c.trim());
  for (const c of cookies) {
    if (!c) continue;
    const idx = c.indexOf("=");
    if (idx === -1) continue;
    const key = c.slice(0, idx);
    const val = c.slice(idx + 1);
    if (key === "token" && val) return decodeURIComponent(val);
  }
  return null;
}

function getTokenFromRequest(req) {
  return getTokenFromCookieHeader(req.headers.cookie || "");
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const maxAgeSec = Math.max(0, Math.floor(SESSION_TTL_MS / 1000));
  const parts = [
    `token=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    "token=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

const TOOL_CONFIG = {
  shell: {
    id: "shell",
    title: "Shell",
    type: "shell",
    command: process.env.SHELL || "bash",
    args: ["--login"],
  },
  kimi: {
    id: "kimi",
    title: "Kimi CLI",
    type: "script",
    command: path.join(__dirname, "kimi"),
    args: [],
  },
  opencode: {
    id: "opencode",
    title: "openCode CLI",
    type: "script",
    command: path.join(__dirname, "opencode"),
    args: [],
  },
  claude: {
    id: "claude",
    title: "Claude Code",
    type: "cli",
    command: "claude",
    args: [],
  },
  gemini: {
    id: "gemini",
    title: "Gemini CLI",
    type: "cli",
    command: "gemini",
    args: ["chat"],
  },
  copilot: {
    id: "copilot",
    title: "GitHub Copilot",
    type: "cli",
    command: "copilot",
    args: [],
  },
  kilocode: {
    id: "kilocode",
    title: "Kilo Code",
    type: "cli",
    command: "kilo",
    args: [],
  },
  codex: {
    id: "codex",
    title: "OpenAI Codex",
    type: "cli",
    command: "codex",
    args: [],
  },
  grok: {
    id: "grok",
    title: "Grok CLI",
    type: "cli",
    command: "grok",
    args: [],
  },
};

function isToolAvailable(tool, env) {
  if (!tool) return false;

  if (tool.type === "shell") {
    const preferred = resolveCommand(tool.command, env);
    const fallback = resolveCommand("sh", env);
    return Boolean(preferred || fallback);
  }

  if (tool.type === "cli") {
    return Boolean(resolveCommand(tool.command, env));
  }

  if (tool.type === "script") {
    if (!isExecutable(tool.command)) return false;

    if (tool.id === "opencode") {
      const binName = process.platform === "darwin" ? "opencode-darwin" : "opencode";
      return isExecutable(path.join(LOCAL_BIN_DIR, binName));
    }

    if (tool.id === "kimi") {
      return isExecutable(path.join(__dirname, "kimi-cli-deps", "bin", "kimi"));
    }

    return true;
  }

  return false;
}

function getSpawnSpec(tool, env) {
  if (tool.type === "shell") {
    const preferred = resolveCommand(tool.command, env);
    const fallback = resolveCommand("sh", env);
    return { command: preferred || fallback || tool.command, args: tool.args || [] };
  }

  return { command: tool.command, args: tool.args || [] };
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

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

app.post("/auth", (req, res) => {
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
  return res.json({ success: true });
});

app.post("/auth/logout", (req, res) => {
  const token = getTokenFromRequest(req);
  revokeSession(sessions, token);
  clearAuthCookie(res);
  return res.json({ success: true });
});

app.get("/api/tools", requireAuth, (_req, res) => {
  const env = buildPtyEnv();
  const tools = Object.values(TOOL_CONFIG).map((tool) => ({
    id: tool.id,
    title: tool.title,
    available: isToolAvailable(tool, env),
  }));
  res.json(tools);
});

wss.on("connection", (ws, req) => {
  const token = getTokenFromCookieHeader(req.headers.cookie || "");
  if (!isValidSession(sessions, token)) {
    sendJson(ws, { type: "error", message: "Unauthorized. Please log in again." });
    ws.close(1008, "unauthorized");
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const toolId = (url.searchParams.get("tool") || "shell").trim();
  const tool = TOOL_CONFIG[toolId];
  const env = buildPtyEnv();

  if (!tool) {
    sendJson(ws, { type: "error", message: `Unknown tool: ${toolId}` });
    ws.close(1003, "unknown tool");
    return;
  }

  if (!isToolAvailable(tool, env)) {
    sendJson(ws, { type: "error", message: `Tool not available: ${tool.title}` });
    ws.close(1003, "tool unavailable");
    return;
  }

  const { command, args } = getSpawnSpec(tool, env);
  let term;
  try {
    term = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: __dirname,
      env,
    });
  } catch (error) {
    sendJson(ws, { type: "error", message: error.message });
    ws.close(1011, "spawn failed");
    return;
  }

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
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
      try {
        term.resize(cols, rows);
      } catch {}
      return;
    }

    if (msg && msg.type === "data") {
      term.write(String(msg.data || ""));
      return;
    }

    term.write(text);
  });

  ws.on("close", () => {
    try {
      term.kill();
    } catch {}
  });

  ws.on("error", () => {
    try {
      term.kill();
    } catch {}
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
  console.log(`Auth mode: ${PASSWORD_MODE}`);
});
