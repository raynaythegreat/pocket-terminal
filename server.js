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

const WORKSPACE_DIR = path.resolve(
  __dirname,
  process.env.WORKSPACE_DIR || path.join("workspace", "projects"),
);

const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

for (const dir of [CLI_HOME_DIR, WORKSPACE_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// CLI tool definitions with cross-access capabilities
const CLI_TOOLS = {
  shell: {
    id: "shell",
    name: "Shell",
    description: "Standard shell session",
    command: process.platform === "win32" ? "cmd.exe" : "bash",
    args: [],
    available: true,
    category: "system"
  },
  gh: {
    id: "gh",
    name: "GitHub CLI",
    description: "GitHub command line interface",
    command: "gh",
    args: [],
    available: false,
    category: "git",
    authRequired: true,
    setupHint: "Run 'gh auth login' to authenticate"
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    description: "AI pair programmer CLI",
    command: "copilot",
    args: [],
    available: false,
    category: "ai",
    authRequired: true,
    setupHint: "Requires GitHub authentication"
  },
  opencode: {
    id: "opencode",
    name: "openCode",
    description: "AI-powered code assistant",
    command: "opencode",
    args: [],
    available: false,
    category: "ai"
  },
  kimi: {
    id: "kimi",
    name: "Kimi Chat",
    description: "Conversational AI CLI",
    command: "kimi",
    args: [],
    available: false,
    category: "ai"
  }
};

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

function buildPtyEnv(toolId = "shell") {
  const mergedPath = [NODE_BIN_DIR, LOCAL_BIN_DIR, __dirname, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);

  const baseEnv = {
    ...process.env,
    HOME: CLI_HOME_DIR,
    PATH: mergedPath,
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PWD: WORKSPACE_DIR,
    
    // CLI interoperability
    CLI_HOME: CLI_HOME_DIR,
    WORKSPACE_DIR: WORKSPACE_DIR,
  };

  // Add GitHub-specific environment variables
  if (process.env.GITHUB_TOKEN) {
    baseEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    baseEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
    baseEnv.COPILOT_API_KEY = process.env.GITHUB_TOKEN;
  }

  // GitHub CLI configuration
  baseEnv.GH_CONFIG_DIR = path.join(CLI_HOME_DIR, ".config", "gh");
  
  // Copilot CLI configuration
  baseEnv.COPILOT_CONFIG_DIR = path.join(CLI_HOME_DIR, ".config", "copilot");

  // Tool-specific environment setup
  if (toolId === "kimi" && fs.existsSync(path.join(__dirname, "kimi-cli-deps", "bin", "activate"))) {
    // For Kimi, we'll activate the virtual environment in the shell startup
    baseEnv.KIMI_VENV = path.join(__dirname, "kimi-cli-deps");
  }

  return baseEnv;
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

function updateToolAvailability() {
  const env = buildPtyEnv();
  
  for (const [toolId, tool] of Object.entries(CLI_TOOLS)) {
    if (toolId === "shell") {
      tool.available = true;
      continue;
    }
    
    const resolvedCommand = resolveCommand(tool.command, env);
    tool.available = resolvedCommand !== null;
    
    if (tool.available) {
      console.log(`✅ ${tool.name} available at: ${resolvedCommand}`);
    } else {
      console.log(`❌ ${tool.name} not found (${tool.command})`);
    }
  }
}

// Update tool availability on startup
updateToolAvailability();

// Refresh tool availability every 5 minutes
setInterval(updateToolAvailability, 5 * 60 * 1000).unref?.();

function getTokenFromCookieHeader(cookieHeader) {
  const cookieValue = cookieHeader || "";
  const cookies = cookieValue.split(";").map((c) => c.trim());
  for (const c of cookies) {
    if (!c) continue;
    const idx = c.indexOf("=");
    if (idx === -1) continue;
    const key = c.slice(0, idx);
    const val = c.slice(idx + 1);
    if (key === "session_token") return val;
  }
  return null;
}

function requireAuth(req, res, next) {
  if (PASSWORD_MODE === "misconfigured") {
    return res.status(500).json({ 
      error: "Server misconfigured", 
      message: "Authentication not properly configured" 
    });
  }

  const token = getTokenFromCookieHeader(req.headers.cookie);
  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ 
      error: "Unauthorized", 
      message: "Valid session required" 
    });
  }
  next();
}

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    sessions: sessions.size,
    passwordMode: PASSWORD_MODE
  });
});

// Authentication endpoints
app.post("/api/auth/login", (req, res) => {
  if (PASSWORD_MODE === "misconfigured") {
    return res.status(500).json({ 
      error: "Server misconfigured",
      message: "Authentication not available" 
    });
  }

  const { password } = req.body;
  if (!password || !verifyPassword(password, PASSWORD_HASH)) {
    return res.status(401).json({ 
      error: "Authentication failed",
      message: "Invalid password" 
    });
  }

  const token = createSession(sessions, SESSION_TTL_MS);
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  
  res.cookie("session_token", token, {
    httpOnly: true,
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    sameSite: "strict",
    expires: expires,
  });

  res.json({ success: true, expiresAt: expires.toISOString() });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = getTokenFromCookieHeader(req.headers.cookie);
  revokeSession(sessions, token);
  
  res.clearCookie("session_token");
  res.json({ success: true });
});

// CLI tools API
app.get("/api/tools", requireAuth, (req, res) => {
  const toolsList = Object.values(CLI_TOOLS).map(tool => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    available: tool.available,
    category: tool.category,
    authRequired: tool.authRequired,
    setupHint: tool.setupHint
  }));

  res.json({ 
    tools: toolsList,
    githubToken: !!process.env.GITHUB_TOKEN 
  });
});

// WebSocket handling for terminal sessions
wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");

  let ptyProcess = null;
  let authenticated = false;
  let currentTool = "shell";

  // Authentication check
  const token = getTokenFromCookieHeader(req.headers.cookie);
  if (!isValidSession(sessions, token)) {
    ws.send(JSON.stringify({ 
      type: "error", 
      message: "Authentication required" 
    }));
    ws.close(1008, "Authentication required");
    return;
  }

  authenticated = true;

  function createPtyProcess(toolId, cols = 80, rows = 24) {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    const tool = CLI_TOOLS[toolId] || CLI_TOOLS.shell;
    const env = buildPtyEnv(toolId);
    
    let command = tool.command;
    let args = [...tool.args];

    // Handle special shell initialization for different tools
    if (toolId === "shell") {
      // For shell, create a custom initialization script
      const initScript = [
        `cd "${WORKSPACE_DIR}"`,
        `source "${LOCAL_BIN_DIR}/cli-env.sh" 2>/dev/null || true`,
        `echo "🚀 Pocket Terminal - ${tool.name} session started"`,
        `echo "💡 Available tools: gh, copilot, opencode, kimi"`,
        `echo "📁 Workspace: ${WORKSPACE_DIR}"`,
        ``
      ].join("; ");
      
      if (process.platform === "win32") {
        args = ["/c", initScript];
      } else {
        args = ["-c", initScript + "; exec bash"];
      }
    } else if (toolId === "kimi" && env.KIMI_VENV) {
      // For Kimi, activate virtual environment first
      const initScript = `source "${env.KIMI_VENV}/bin/activate" && cd "${WORKSPACE_DIR}" && exec "${tool.command}"`;
      command = "bash";
      args = ["-c", initScript];
    } else {
      // For other tools, resolve the command path
      const resolvedCommand = resolveCommand(tool.command, env);
      if (!resolvedCommand) {
        throw new Error(`Command not found: ${tool.command}`);
      }
      command = resolvedCommand;
    }

    try {
      ptyProcess = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: clampInt(cols, 20, 200, 80),
        rows: clampInt(rows, 5, 100, 24),
        cwd: WORKSPACE_DIR,
        env: env,
      });

      ptyProcess.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      });

      ptyProcess.onExit((code, signal) => {
        console.log(`PTY process exited: code=${code}, signal=${signal}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: "exit", 
            code, 
            signal,
            tool: toolId
          }));
        }
      });

      console.log(`Created PTY process for tool: ${toolId} (PID: ${ptyProcess.pid})`);
      return ptyProcess;
      
    } catch (error) {
      console.error(`Failed to create PTY for ${toolId}:`, error);
      throw error;
    }
  }

  ws.on("message", (message) => {
    if (!authenticated) return;

    try {
      const msg = JSON.parse(message.toString());
      
      switch (msg.type) {
        case "launch":
          const toolId = msg.tool || "shell";
          if (!CLI_TOOLS[toolId]) {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `Unknown tool: ${toolId}` 
            }));
            return;
          }

          if (!CLI_TOOLS[toolId].available && toolId !== "shell") {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `Tool not available: ${CLI_TOOLS[toolId].name}. ${CLI_TOOLS[toolId].setupHint || ""}` 
            }));
            return;
          }

          try {
            currentTool = toolId;
            createPtyProcess(toolId, msg.cols, msg.rows);
            ws.send(JSON.stringify({ 
              type: "launched", 
              tool: toolId,
              name: CLI_TOOLS[toolId].name
            }));
          } catch (error) {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `Failed to launch ${CLI_TOOLS[toolId].name}: ${error.message}` 
            }));
          }
          break;

        case "data":
          if (ptyProcess) {
            ptyProcess.write(msg.data);
          }
          break;

        case "resize":
          if (ptyProcess) {
            const cols = clampInt(msg.cols, 20, 200, 80);
            const rows = clampInt(msg.rows, 5, 100, 24);
            ptyProcess.resize(cols, rows);
          }
          break;

        default:
          console.warn("Unknown message type:", msg.type);
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
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });

  // Send initial connection success
  ws.send(JSON.stringify({ 
    type: "connected",
    message: "Terminal session ready" 
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Pocket Terminal server running on port ${PORT}`);
  console.log(`🔐 Password mode: ${PASSWORD_MODE}`);
  console.log(`📁 Workspace: ${WORKSPACE_DIR}`);
  console.log(`🏠 CLI Home: ${CLI_HOME_DIR}`);
  console.log(`🔧 Local bin: ${LOCAL_BIN_DIR}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});