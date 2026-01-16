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

// CLI tool definitions with interactive authentication
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
    description: "GitHub command line interface - use 'gh auth login' to authenticate",
    command: "gh",
    args: [],
    available: false,
    category: "git",
    setupHint: "Run 'gh auth login' to authenticate with GitHub",
    icon: "🐙"
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    description: "AI pair programmer CLI - authenticate via 'gh auth login'",
    command: "github-copilot-cli",
    args: [],
    available: false,
    category: "ai",
    setupHint: "Authenticate with 'gh auth login' first",
    icon: "🤖"
  },
  gemini: {
    id: "gemini",
    name: "Gemini AI",
    description: "Google's conversational AI - use 'gcloud auth login' to authenticate",
    command: "gemini-cli",
    args: [],
    available: false,
    category: "ai",
    setupHint: "Run 'gcloud auth login' to authenticate",
    icon: "🔮"
  },
  gcloud: {
    id: "gcloud",
    name: "Google Cloud",
    description: "Google Cloud Platform CLI - use 'gcloud auth login' to authenticate",
    command: "gcloud",
    args: [],
    available: false,
    category: "cloud",
    setupHint: "Run 'gcloud auth login' to authenticate",
    icon: "☁️"
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    description: "AI coding assistant - interactive authentication",
    command: "opencode",
    args: [],
    available: false,
    category: "ai",
    setupHint: "Tool will prompt for authentication when needed",
    icon: "⚡"
  },
  kimi: {
    id: "kimi",
    name: "Kimi",
    description: "AI assistant CLI - interactive authentication",
    command: "kimi",
    args: [],
    available: false,
    category: "ai",
    setupHint: "Tool will prompt for authentication when needed",
    icon: "🎯"
  }
};

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Authentication endpoints
app.post("/auth/login", (req, res) => {
  const { password } = req.body;

  if (PASSWORD_MODE === "misconfigured") {
    return res.status(500).json({ 
      success: false, 
      error: "Server authentication is not properly configured" 
    });
  }

  if (!verifyPassword(password, PASSWORD_HASH)) {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  const token = createSession(sessions, SESSION_TTL_MS);
  res.json({ success: true, token });
});

app.post("/auth/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  revokeSession(sessions, token);
  res.json({ success: true });
});

// CLI tools endpoint
app.get("/api/tools", authenticateToken, (req, res) => {
  const toolsWithAvailability = Object.values(CLI_TOOLS).map((tool) => ({
    ...tool,
    available: checkToolAvailability(tool),
  }));
  res.json(toolsWithAvailability);
});

// Check if a CLI tool is available
function checkToolAvailability(tool) {
  if (tool.id === "shell") return true;

  const { command } = tool;
  const pathDirs = [
    LOCAL_BIN_DIR,
    NODE_BIN_DIR,
    ...process.env.PATH.split(path.delimiter),
  ];

  for (const dir of pathDirs) {
    const fullPath = path.join(dir, command + (process.platform === "win32" ? ".exe" : ""));
    try {
      if (fs.existsSync(fullPath)) {
        return true;
      }
    } catch (error) {
      continue;
    }
  }

  // Special cases for tools that might have different executable names
  if (command === "github-copilot-cli" || command === "copilot") {
    return checkForAlternativeCommands(["gh-copilot", "copilot", "github-copilot"]);
  }
  if (command === "gemini-cli") {
    return checkForAlternativeCommands(["gemini", "gcloud"]);
  }
  if (command === "opencode") {
    return checkForAlternativeCommands(["opencode", "oc"]);
  }

  return false;
}

function checkForAlternativeCommands(commands) {
  const pathDirs = [
    LOCAL_BIN_DIR,
    NODE_BIN_DIR,
    ...process.env.PATH.split(path.delimiter),
  ];

  for (const command of commands) {
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, command + (process.platform === "win32" ? ".exe" : ""));
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
  console.log("New WebSocket connection");
  
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === "auth") {
        await handleAuthMessage(ws, data);
      } else if (data.type === "launch") {
        await handleLaunchMessage(ws, data);
      } else if (data.type === "data") {
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