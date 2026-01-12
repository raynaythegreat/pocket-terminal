require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TERMINAL_PASSWORD || "changeme";

const OPENCODE_BINARY =
  process.platform === "darwin"
    ? path.join(__dirname, "bin", "opencode-darwin")
    : path.join(__dirname, "bin", "opencode");

// Add node_modules/.bin, local bin, and kimi-cli-deps to PATH for CLI tools
const nodeModulesBin = path.join(__dirname, "node_modules", ".bin");
const localBin = path.join(__dirname, "bin");
const kimiBin = path.join(__dirname, "kimi-cli-deps", "bin");
const enhancedPath = `${localBin}:${kimiBin}:${nodeModulesBin}:${process.env.PATH}`;

// Create workspace directory for projects
const workspaceDir =
  process.env.WORKSPACE_DIR || path.join(__dirname, "workspace");
if (!fs.existsSync(workspaceDir)) {
  fs.mkdirSync(workspaceDir, { recursive: true });
}

// Available CLI tools configuration
const CLI_TOOLS = {
  opencode: {
    name: "OpenCode",
    command: OPENCODE_BINARY,
    description: "AI coding assistant from Anomaly",
  },
  kimi: {
    name: "Kimi CLI",
    command: "kimi",
    description: "Moonshot AI CLI agent",
  },
  claude: {
    name: "Claude Code",
    command: "claude",
    description: "Sign in with your Anthropic account",
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    description: "Sign in with your Google account",
  },
  codex: {
    name: "Codex",
    command: "codex",
    description: "Sign in with your OpenAI account",
  },
  grok: {
    name: "Grok",
    command: "grok",
    description: "Sign in with your xAI account",
  },
  github: {
    name: "GitHub CLI",
    command: "gh",
    description: "Manage repos, PRs, issues & more",
  },
  bash: {
    name: "Bash Shell",
    command: "bash",
    description: "Full terminal - run any command",
  },
};

// Store active sessions and terminals
const sessions = new Map();
const terminals = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(command, pathEnv) {
  if (!command) return null;

  const isPathLike =
    path.isAbsolute(command) ||
    command.startsWith("./") ||
    command.startsWith("../") ||
    command.includes("/") ||
    command.includes("\\");

  if (isPathLike) {
    const absolute = path.isAbsolute(command)
      ? command
      : path.resolve(__dirname, command);
    return isExecutable(absolute) ? absolute : null;
  }

  const searchPath = pathEnv || process.env.PATH || "";
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Health check (useful for Render)
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Auth endpoint
app.post("/auth", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = generateToken();
    sessions.set(token, { created: Date.now(), lastActivity: Date.now() });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

// Get available CLIs endpoint
app.get("/api/clis", (req, res) => {
  const clis = Object.entries(CLI_TOOLS).map(([id, cli]) => ({
    id,
    name: cli.name,
    description: cli.description,
    available: Boolean(resolveCommand(cli.command, enhancedPath)),
  }));
  res.json(clis);
});

function isValidSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  const maxAge = 24 * 60 * 60 * 1000;
  if (Date.now() - session.created > maxAge) {
    sessions.delete(token);
    return false;
  }
  session.lastActivity = Date.now();
  return true;
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  let authenticated = false;
  let activeTerminal = null;

  function killActiveTerminal() {
    const terminalToKill = activeTerminal;
    if (!terminalToKill) return;

    activeTerminal = null;
    terminals.delete(terminalToKill.id);

    try {
      terminalToKill.pty.kill("SIGTERM");
      setTimeout(() => {
        try {
          terminalToKill.pty.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 500);
    } catch {
      // ignore
    }
  }

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      // Handle authentication
      if (message.type === "auth") {
        if (isValidSession(message.token)) {
          authenticated = true;
          ws.send(JSON.stringify({ type: "authenticated" }));
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Invalid or expired session",
            }),
          );
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      // Handle kill request - important for switching CLIs
      if (message.type === "kill") {
        killActiveTerminal();
        ws.send(JSON.stringify({ type: "killed" }));
        return;
      }

      // Handle launching a CLI
      if (message.type === "launch") {
        const cliId = message.cli || "bash";
        const cli = CLI_TOOLS[cliId];

        if (!cli) {
          ws.send(JSON.stringify({ type: "error", error: "Unknown CLI tool" }));
          return;
        }

        // Kill existing terminal first
        killActiveTerminal();

        const resolvedCommand = resolveCommand(cli.command, enhancedPath);
        if (!resolvedCommand) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `${cli.name} is not installed on this server.`,
            }),
          );
          return;
        }

        const terminalId = crypto.randomBytes(8).toString("hex");

        // Build environment
        const homeDir = process.env.HOME || "/tmp";
        const termEnv = {
          ...process.env,
          PATH: enhancedPath,
          TERM: "xterm-256color",
          HOME: homeDir,
          XDG_CONFIG_HOME: path.join(homeDir, ".config"),
          XDG_DATA_HOME: path.join(homeDir, ".local/share"),
          FORCE_COLOR: "1",
        };

        const cols = Math.max(10, Number(message.cols) || 80);
        const rows = Math.max(5, Number(message.rows) || 24);

        try {
          // Spawn the CLI directly (not through bash -c)
          const ptyProcess = pty.spawn(resolvedCommand, [], {
            name: "xterm-256color",
            cols,
            rows,
            cwd: workspaceDir,
            env: termEnv,
          });

          activeTerminal = { id: terminalId, cli: cliId, pty: ptyProcess };
          terminals.set(terminalId, ptyProcess);

          ptyProcess.onData((output) => {
            if (
              ws.readyState === WebSocket.OPEN &&
              activeTerminal?.id === terminalId
            ) {
              ws.send(JSON.stringify({ type: "output", data: output }));
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            terminals.delete(terminalId);
            if (activeTerminal?.id === terminalId) {
              activeTerminal = null;
            }

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "exit",
                  code: exitCode,
                  cli: cliId,
                }),
              );
            }
          });

          ws.send(
            JSON.stringify({
              type: "launched",
              terminalId,
              cli: cliId,
              name: cli.name,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Failed to launch ${cli.name}: ${err.message}`,
            }),
          );
        }

        return;
      }

      // Handle terminal input
      if (message.type === "input" && activeTerminal?.pty) {
        activeTerminal.pty.write(message.data);
      }

      // Handle terminal resize
      if (message.type === "resize" && activeTerminal?.pty) {
        const colsValue = Number(message.cols);
        const rowsValue = Number(message.rows);
        const cols = Math.max(
          10,
          Number.isFinite(colsValue) ? colsValue : activeTerminal.pty.cols || 80,
        );
        const rows = Math.max(
          5,
          Number.isFinite(rowsValue) ? rowsValue : activeTerminal.pty.rows || 24,
        );
        activeTerminal.pty.resize(cols, rows);
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
    }
  });

  ws.on("close", () => {
    killActiveTerminal();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

// Clean up expired sessions
setInterval(
  () => {
    const maxAge = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (now - session.created > maxAge) {
        sessions.delete(token);
      }
    }
  },
  60 * 60 * 1000,
);

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`\nAvailable CLIs: ${Object.keys(CLI_TOOLS).join(", ")}`);
});
