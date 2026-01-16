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
    description: "Standard shell session with access to all CLI tools",
    command: process.platform === "win32" ? "cmd.exe" : "bash",
    args: [],
    available: true,
    category: "system",
    icon: "🖥️"
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
    setupHint: "Run 'gh auth login' to authenticate with GitHub",
    icon: "🐙"
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    description: "AI pair programmer CLI",
    command: "github-copilot-cli",
    args: [],
    available: false,
    category: "ai",
    authRequired: true,
    setupHint: "Requires GitHub authentication (gh auth login)",
    icon: "🤖"
  },
  gemini: {
    id: "gemini",
    name: "Gemini AI",
    description: "Google's conversational AI assistant",
    command: "gcloud",
    args: ["ai", "chat"],
    available: false,
    category: "ai",
    authRequired: true,
    setupHint: "Run 'gcloud auth login' and set up your project",
    icon: "🔮"
  },
  gcloud: {
    id: "gcloud",
    name: "Google Cloud",
    description: "Google Cloud Platform CLI",
    command: "gcloud",
    args: [],
    available: false,
    category: "cloud",
    authRequired: true,
    setupHint: "Run 'gcloud auth login' to authenticate",
    icon: "☁️"
  },
  openai: {
    id: "openai",
    name: "OpenAI CLI",
    description: "OpenAI command line interface",
    command: "openai",
    args: [],
    available: false,
    category: "ai",
    authRequired: true,
    setupHint: "Set OPENAI_API_KEY environment variable",
    icon: "🎯"
  },
  anthropic: {
    id: "anthropic",
    name: "Claude CLI",
    description: "Anthropic's Claude AI assistant",
    command: "claude",
    args: [],
    available: false,
    category: "ai",
    authRequired: true,
    setupHint: "Set ANTHROPIC_API_KEY environment variable",
    icon: "🧠"
  }
};

// Check tool availability
function checkToolAvailability() {
  const { execSync } = require("child_process");
  
  for (const tool of Object.values(CLI_TOOLS)) {
    if (tool.id === "shell") continue; // Shell is always available
    
    try {
      // Check if command exists in PATH or local bin
      const paths = [
        ...process.env.PATH.split(path.delimiter),
        LOCAL_BIN_DIR,
        NODE_BIN_DIR
      ];
      
      let found = false;
      for (const p of paths) {
        const fullPath = path.join(p, tool.command + (process.platform === "win32" ? ".exe" : ""));
        if (fs.existsSync(fullPath)) {
          found = true;
          break;
        }
      }
      
      if (found) {
        // Double-check by trying to run --version or --help
        execSync(`${tool.command} --version 2>/dev/null || ${tool.command} --help 2>/dev/null`, 
          { timeout: 5000, stdio: 'ignore' });
        tool.available = true;
      }
    } catch (error) {
      // Tool not available
      tool.available = false;
    }
  }
}

// Check tool availability on startup
checkToolAvailability();

// Enhanced environment for CLI tools
function createEnhancedEnv() {
  const env = { ...process.env };
  
  // Add local bin directories to PATH
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  const existingPath = env.PATH || "";
  env.PATH = [LOCAL_BIN_DIR, NODE_BIN_DIR, existingPath].join(pathSeparator);
  
  // Set up CLI home directories
  env.HOME = CLI_HOME_DIR;
  env.CLI_HOME = CLI_HOME_DIR;
  
  // GitHub CLI configuration
  env.GH_CONFIG_DIR = path.join(CLI_HOME_DIR, ".config", "gh");
  
  // Google Cloud configuration
  env.CLOUDSDK_CONFIG = path.join(CLI_HOME_DIR, ".config", "gcloud");
  
  // Ensure config directories exist
  for (const configDir of [env.GH_CONFIG_DIR, env.CLOUDSDK_CONFIG]) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }
  
  return env;
}

// Middleware
app.use(express.json());
app.use(express.static("public", {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : "0",
  etag: true
}));

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Authentication endpoint
app.post("/auth/login", (req, res) => {
  const { password } = req.body;

  if (PASSWORD_MODE === "misconfigured") {
    return res.status(503).json({ 
      error: "Authentication service misconfigured", 
      message: "Server cannot authenticate users in current configuration" 
    });
  }

  if (!verifyPassword(password, PASSWORD_HASH)) {
    return res.status(401).json({ 
      error: "Invalid password", 
      message: "The provided password is incorrect" 
    });
  }

  const token = createSession(sessions, SESSION_TTL_MS);
  res.json({ token, expiresIn: SESSION_TTL_MS });
});

// Logout endpoint
app.post("/auth/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  revokeSession(sessions, token);
  res.json({ success: true });
});

// CLI tools endpoint
app.get("/api/tools", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Refresh tool availability
  checkToolAvailability();
  
  res.json({
    tools: Object.values(CLI_TOOLS),
    authStatus: {
      github: !!process.env.GITHUB_TOKEN,
      gcloud: fs.existsSync(path.join(CLI_HOME_DIR, ".config", "gcloud", "credentials.db")),
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY
    }
  });
});

// WebSocket connections
const connections = new Map(); // ws -> { token, ptyProcess, tool }

wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");
  
  let ptyProcess = null;
  let authenticated = false;
  let currentTool = null;

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "auth":
          const { token } = message;
          if (isValidSession(sessions, token)) {
            authenticated = true;
            connections.set(ws, { token, ptyProcess: null, tool: null });
            ws.send(JSON.stringify({ type: "auth", success: true }));
          } else {
            ws.send(JSON.stringify({ 
              type: "auth", 
              success: false, 
              error: "Invalid session token" 
            }));
            ws.close();
          }
          break;

        case "launch":
          if (!authenticated) {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Not authenticated" 
            }));
            return;
          }

          const { tool } = message;
          currentTool = tool;
          
          if (ptyProcess) {
            ptyProcess.kill();
            ptyProcess = null;
          }

          const toolConfig = CLI_TOOLS[tool];
          if (!toolConfig) {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Unknown tool" 
            }));
            return;
          }

          if (!toolConfig.available && tool !== "shell") {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: `Tool '${toolConfig.name}' is not installed on this server` 
            }));
            return;
          }

          const env = createEnhancedEnv();
          
          try {
            ptyProcess = pty.spawn(toolConfig.command, toolConfig.args, {
              name: "xterm-256color",
              cols: message.cols || 80,
              rows: message.rows || 24,
              cwd: WORKSPACE_DIR,
              env: env,
              encoding: "utf8"
            });

            // Update connection info
            const connInfo = connections.get(ws);
            if (connInfo) {
              connInfo.ptyProcess = ptyProcess;
              connInfo.tool = tool;
            }

            ptyProcess.onData((data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "data", data }));
              }
            });

            ptyProcess.onExit((code, signal) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                  type: "exit", 
                  code, 
                  signal,
                  message: `Process exited with code ${code}` 
                }));
              }
              ptyProcess = null;
              const connInfo = connections.get(ws);
              if (connInfo) {
                connInfo.ptyProcess = null;
              }
            });

            ws.send(JSON.stringify({ 
              type: "launched", 
              tool: tool,
              name: toolConfig.name 
            }));

          } catch (error) {
            console.error("Error launching tool:", error);
            ws.send(JSON.stringify({ 
              type: "error", 
              error: `Failed to launch ${toolConfig.name}: ${error.message}` 
            }));
          }
          break;

        case "data":
          if (ptyProcess && authenticated) {
            ptyProcess.write(message.data);
          }
          break;

        case "resize":
          if (ptyProcess && authenticated) {
            ptyProcess.resize(message.cols || 80, message.rows || 24);
          }
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;

        default:
          console.warn("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({ 
        type: "error", 
        error: "Invalid message format" 
      }));
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
    connections.delete(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
    connections.delete(ws);
  });

  // Send initial ping to establish connection
  ws.send(JSON.stringify({ type: "ping" }));
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  
  // Close all WebSocket connections and kill processes
  for (const [ws, connInfo] of connections.entries()) {
    if (connInfo.ptyProcess) {
      connInfo.ptyProcess.kill();
    }
    ws.close();
  }
  
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  
  // Close all WebSocket connections and kill processes
  for (const [ws, connInfo] of connections.entries()) {
    if (connInfo.ptyProcess) {
      connInfo.ptyProcess.kill();
    }
    ws.close();
  }
  
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal server running on port ${PORT}`);
  console.log(`Password mode: ${PASSWORD_MODE}`);
  console.log(`Workspace directory: ${WORKSPACE_DIR}`);
  console.log(`CLI home directory: ${CLI_HOME_DIR}`);
  
  // Log available tools
  const availableTools = Object.values(CLI_TOOLS).filter(t => t.available);
  console.log(`Available CLI tools: ${availableTools.map(t => t.name).join(", ")}`);
});