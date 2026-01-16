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
    command: "gemini",
    args: ["chat"],
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
  opencode: {
    id: "opencode",
    name: "openCode",
    description: "AI-powered code assistant",
    command: "opencode",
    args: [],
    available: false,
    category: "ai",
    icon: "📝"
  },
  kimi: {
    id: "kimi",
    name: "Kimi Chat",
    description: "Conversational AI CLI",
    command: "kimi",
    args: ["chat"],
    available: false,
    category: "ai",
    icon: "🎭"
  }
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function checkToolAvailability() {
  const pathDirs = [
    LOCAL_BIN_DIR,
    NODE_BIN_DIR,
    ...process.env.PATH.split(path.delimiter),
  ];

  for (const [toolId, tool] of Object.entries(CLI_TOOLS)) {
    if (toolId === "shell") continue; // Shell is always available

    let isAvailable = false;
    
    // Check each PATH directory
    for (const dir of pathDirs) {
      if (!dir) continue;
      
      const toolPath = path.join(dir, tool.command);
      const toolPathExe = toolPath + (process.platform === "win32" ? ".exe" : "");
      
      try {
        if (fs.existsSync(toolPath) || fs.existsSync(toolPathExe)) {
          const stats = fs.statSync(fs.existsSync(toolPath) ? toolPath : toolPathExe);
          if (stats.isFile() && (stats.mode & 0o111)) {
            isAvailable = true;
            break;
          }
        }
      } catch (err) {
        // Ignore errors and continue checking
      }
    }

    CLI_TOOLS[toolId].available = isAvailable;
  }

  console.log("Tool availability check completed:");
  Object.entries(CLI_TOOLS).forEach(([id, tool]) => {
    console.log(`  ${tool.icon || '📦'} ${tool.name}: ${tool.available ? '✅' : '❌'}`);
  });
}

// Check tool availability on startup and periodically
checkToolAvailability();
setInterval(checkToolAvailability, 5 * 60 * 1000); // Check every 5 minutes

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/healthz", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size,
    passwordMode: PASSWORD_MODE
  });
});

app.post("/api/auth", (req, res) => {
  if (PASSWORD_MODE === "misconfigured") {
    return res.status(500).json({ error: "Server authentication misconfigured" });
  }

  const { password } = req.body;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  if (!verifyPassword(password, PASSWORD_HASH)) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = createSession(sessions, SESSION_TTL_MS);
  res.json({ token, expiresIn: SESSION_TTL_MS });
});

app.post("/api/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  revokeSession(sessions, token);
  res.json({ success: true });
});

app.get("/api/tools", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!isValidSession(sessions, token)) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Return tools grouped by category
  const toolsByCategory = {};
  Object.values(CLI_TOOLS).forEach(tool => {
    if (!toolsByCategory[tool.category]) {
      toolsByCategory[tool.category] = [];
    }
    toolsByCategory[tool.category].push(tool);
  });

  res.json({
    tools: CLI_TOOLS,
    toolsByCategory,
    authStatus: {
      github: {
        required: CLI_TOOLS.gh.available || CLI_TOOLS.copilot.available,
        envVar: "GITHUB_TOKEN"
      },
      google: {
        required: CLI_TOOLS.gemini.available || CLI_TOOLS.gcloud.available,
        envVar: "GOOGLE_CLOUD_PROJECT"
      }
    }
  });
});

// Enhanced WebSocket handling
wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection");
  
  let ptyProcess = null;
  let isAuthenticated = false;
  let heartbeatInterval = null;

  // Setup heartbeat
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);

  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (ptyProcess && !ptyProcess.killed) {
      try {
        ptyProcess.kill();
      } catch (err) {
        console.error("Error killing pty process:", err);
      }
    }
  };

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "auth":
          if (!message.token || !isValidSession(sessions, message.token)) {
            ws.send(JSON.stringify({ type: "auth_error", message: "Invalid token" }));
            return;
          }
          
          isAuthenticated = true;
          ws.send(JSON.stringify({ type: "auth_success" }));
          break;

        case "start_terminal":
          if (!isAuthenticated) {
            ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
            return;
          }

          if (ptyProcess) {
            ptyProcess.kill();
          }

          const toolId = message.tool || "shell";
          const tool = CLI_TOOLS[toolId];
          
          if (!tool) {
            ws.send(JSON.stringify({ type: "error", message: "Unknown tool" }));
            return;
          }

          if (!tool.available && toolId !== "shell") {
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `${tool.name} is not available. ${tool.setupHint || 'Please install it first.'}` 
            }));
            return;
          }

          const cols = clampInt(message.cols, 10, 300, 80);
          const rows = clampInt(message.rows, 2, 100, 24);

          // Enhanced environment setup
          const termEnv = {
            ...process.env,
            HOME: CLI_HOME_DIR,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            PATH: [
              LOCAL_BIN_DIR,
              NODE_BIN_DIR,
              process.env.PATH
            ].join(path.delimiter),
            // CLI-specific environment variables
            WORKSPACE_DIR: WORKSPACE_DIR,
            CLI_HOME_DIR: CLI_HOME_DIR,
            // GitHub CLI environment
            GH_PAGER: "cat",
            GH_NO_UPDATE_NOTIFIER: "1",
            // Google Cloud environment
            CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true",
            CLOUDSDK_CORE_DISABLE_FILE_LOGGING: "true",
            // Terminal identification for CLIs
            POCKET_TERMINAL: "1",
            MOBILE_TERMINAL: "1"
          };

          try {
            let command = tool.command;
            let args = [...(tool.args || [])];

            // For shell, add initialization commands to set up CLI access
            if (toolId === "shell") {
              // Create a startup script that adds bin to PATH and shows available tools
              const initScript = `
export PATH="${LOCAL_BIN_DIR}:$PATH"
echo "🚀 Pocket Terminal - All CLI tools available"
echo "📦 Available tools: $(ls ${LOCAL_BIN_DIR} 2>/dev/null | tr '\\n' ' ' || echo 'none')"
echo "💡 Type a tool name to start using it, or use standard shell commands"
echo ""
`;
              
              // Write init script temporarily
              const initFile = path.join(CLI_HOME_DIR, ".pocket_terminal_init");
              fs.writeFileSync(initFile, initScript);
              
              if (process.platform !== "win32") {
                args = ["-c", `source "${initFile}"; exec bash -i`];
              }
            }

            ptyProcess = pty.spawn(command, args, {
              cwd: toolId === "shell" ? WORKSPACE_DIR : CLI_HOME_DIR,
              env: termEnv,
              cols,
              rows,
              name: "xterm-color",
              useConpty: false
            });

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
                  message: `${tool.name} session ended (${code || signal})`
                }));
              }
              ptyProcess = null;