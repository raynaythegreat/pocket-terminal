require("dotenv").config();

const path = require("path");
const fs = require("fs");
const http = require("http");
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

// Basic middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
// We support multiple tools. Local scripts are relative to repo root.
// For node-based CLIs, we try to spawn from PATH (node_modules/.bin should be in PATH for Render).
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
    // Binary name as installed by @anthropic-ai/claude-code
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
    type: "cli",
    command: "grok",
  },
};

// Check if a tool is available
function isToolAvailable(tool) {
  if (tool.type === "shell") {
    return { available: true, reason: null };
  }
  if (tool.type === "script") {
    const exists = fs.existsSync(tool.command);
    return {
      available: exists,
      reason: exists ? null : "Script not found on server",
    };
  }
  if (tool.type === "cli") {
    // Best-effort: we assume that if it's installed, the binary name will resolve via PATH
    // We do NOT run "which" here to keep things simple/portable.
    // Instead, we optimistically mark it "unknown" and let runtime spawn handle errors.
    // To be conservative for the UI, we mark them as unavailable by default.
    return {
      available: false,
      reason: "Optional CLI not installed on server",
    };
  }
  return { available: false, reason: "Unknown tool type" };
}

// Resolve spawn command for a given tool id
function resolveToolCommand(toolId) {
  const tool = TOOL_CONFIG[toolId] || TOOL_CONFIG.shell;

  if (tool.type === "shell") {
    const shell = process.env.SHELL || "/bin/bash";
    return {
      tool,
      file: shell,
      args: [],
    };
  }

  if (tool.type === "script") {
    return {
      tool,
      file: tool.command,
      args: [],
    };
  }

  if (tool.type === "cli") {
    // We attempt to spawn the CLI by its command name.
    return {
      tool,
      file: tool.command,
      args: [],
    };
  }

  // Fallback to shell
  const shell = process.env.SHELL || "/bin/bash";
  return {
    tool: TOOL_CONFIG.shell,
    file: shell,
    args: [],
  };
}

// Auth routes
app.post("/auth", (req, res) => {
  try {
    if (PASSWORD_MODE === "misconfigured") {
      return res.status(503).json({
        success: false,
        error: "server_misconfigured",
        message:
          "Server authentication is not configured. Admin must set TERMINAL_PASSWORD.",
      });
    }

    const { password } = req.body || {};
    if (typeof password !== "string" || !password.trim()) {
      return res.status(400).json({
        success: false,
        error: "invalid_request",
        message: "Password is required.",
      });
    }

    const ok = verifyPassword(password, PASSWORD_HASH);
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: "invalid_password",
        message: "Invalid password.",
      });
    }

    const token = createSession(sessions, SESSION_TTL_MS);
    // Set httpOnly cookie
    res.cookie
      ? res
          .cookie("token", token, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: SESSION_TTL_MS,
            secure: process.env.NODE_ENV === "production",
          })
          .json({ success: true, token })
      : res
          .setHeader(
            "Set-Cookie",
            `token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${
              SESSION_TTL_MS / 1000
            }; ${
              process.env.NODE_ENV === "production" ? "Secure; SameSite=Lax" : ""
            }`
          )
          .json({ success: true, token });
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error",
    });
  }
});

app.post("/logout", requireAuth, (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    revokeSession(sessions, token);
    if (res.clearCookie) {
      res.clearCookie("token");
    } else {
      res.setHeader(
        "Set-Cookie",
        "token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

// Auth status endpoint
app.get("/auth/status", (req, res) => {
  const isProd = (process.env.NODE_ENV || "development") === "production";
  res.json({
    authConfigured: PASSWORD_MODE !== "misconfigured",
    mode: isProd ? undefined : PASSWORD_MODE,
  });
});

// Tools endpoint (for UI)
app.get("/tools", requireAuth, (req, res) => {
  const tools = Object.values(TOOL_CONFIG).map((tool) => {
    const status = isToolAvailable(tool);
    return {
      id: tool.id,
      title: tool.title,
      available: status.available,
      reason: status.reason,
    };
  });
  res.json({ tools });
});

// WebSocket server for terminal
const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP to WebSocket
server.on("upgrade", (request, socket, head) => {
  const { url, headers } = request;

  // Only handle /terminal
  if (!url || !url.startsWith("/terminal")) {
    socket.destroy();
    return;
  }

  // Simple cookie-based auth for WS
  const cookieHeader = headers.cookie || "";
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  let token = null;
  for (const c of cookies) {
    if (!c) continue;
    const [k, v] = c.split("=");
    if (k === "token" && v) {
      token = decodeURIComponent(v);
      break;
    }
  }

  if (!isValidSession(sessions, token)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws, req) => {
  try {
    // Parse tool from query string
    const urlObj = new URL(req.url || "", "http://localhost");
    const toolId = urlObj.searchParams.get("tool") || "shell";
    const { tool, file, args } = resolveToolCommand(toolId);

    // Check availability for scripts before spawning
    if (tool.type === "script") {
      const exists = fs.existsSync(file);
      if (!exists) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Tool "${tool.id}" is not installed on the server.`,
          })
        );
        ws.close();
        return;
      }
    }

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(file, args, {
        name: "xterm-color",
        cols: 80,
        rows: 30,
        cwd: process.env.HOME || process.cwd(),
        env: process.env,
      });
    } catch (spawnErr) {
      console.error("Failed to spawn PTY for tool", tool.id, spawnErr);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Failed to start tool "${tool.id}". It may not be installed or is not executable.`,
        })
      );
      ws.close();
      return;
    }

    ptyProcess.onData((data) => {
      try {
        ws.send(data);
      } catch (err) {
        console.error("Error sending data to WS client:", err);
      }
    });

    ws.on("message", (msg) => {
      try {
        if (typeof msg === "string") {
          ptyProcess.write(msg);
        } else if (Buffer.isBuffer(msg)) {
          ptyProcess.write(msg.toString("utf8"));
        }
      } catch (err) {
        console.error("Error writing to PTY:", err);
      }
    });

    ws.on("close", () => {
      try {
        ptyProcess.kill();
      } catch (err) {
        console.error("Error killing PTY:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      try {
        ptyProcess.kill();
      } catch (e) {
        // ignore
      }
    });
  } catch (err) {
    console.error("WS connection error:", err);
    try {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Internal server error while establishing terminal.",
        })
      );
      ws.close();
    } catch (e) {
      // ignore
    }
  }
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal listening on port ${PORT}`);
});