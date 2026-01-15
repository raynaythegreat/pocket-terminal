require("dotenv").config();

const path = require("path");
const fs = require("fs");
const http = require("server");
const express = require("express");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const {
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  cleanupExpiredSessions,
  buildPasswordConfig,
} = require("./auth");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Build password configuration
const { mode: PASSWORD_MODE, passwordHash: PASSWORD_HASH } = buildPasswordConfig(
  {
    TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  },
  console
);

// Session management
const SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7
); // default 7 days
const sessions = new Map(); // token -> { expiresAt }

// Session cleanup interval (every 30 minutes)
setInterval(() => {
  const cleaned = cleanupExpiredSessions(sessions);
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions. Active sessions: ${sessions.size}`);
  }
}, 30 * 60 * 1000);

// Terminal session management
const terminalSessions = new Map(); // sessionId -> { ptyProcess, tool }

// Basic middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Simple cookie parser for auth (HTTP)
function getTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const c of cookies) {
    if (!c) continue;
    const [k, v] = c.split("=");
    if (k === "token" && v) {
      return decodeURIComponent(v);
    }
  }
  return null;
}

// HTTP auth guard
function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

// Tool configuration
const TOOL_CONFIG = {
  shell: {
    id: "shell",
    title: "Shell",
    type: "shell",
  },
  kimi: {
    id: "kimi",
    title: "Kimi CLI",
    type: "script",
    command: path.join(__dirname, "kimi"),
  },
  opencode: {
    id: "opencode",
    title: "Opencode CLI",
    type: "script",
    command: path.join(__dirname, "opencode"),
  },
  claude: {
    id: "claude",
    title: "Claude Code",
    type: "cli",
    command: "claude-code",
  },
  gemini: {
    id: "gemini",
    title: "Gemini CLI",
    type: "cli",
    command: "gemini",
  },
  copilot: {
    id: "copilot",
    title: "GitHub Copilot CLI",
    type: "cli",
    command: "github-copilot",
  },
  kilocode: {
    id: "kilocode",
    title: "Kilocode CLI",
    type: "cli",
    command: "kilocode",
  },
  codex: {
    id: "codex",
    title: "OpenAI Codex CLI",
    type: "cli",
    command: "codex",
  },
  grok: {
    id: "grok",
    title: "Grok CLI",
    type: "