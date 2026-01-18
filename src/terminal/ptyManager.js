const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const { logger } = require("../utils/logger");

class PTYManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  /**
   * Spawns a new PTY for a specific tool
   */
  spawn(sessionId, toolId, { cols = 80, rows = 24 } = {}) {
    // Resolve shell and arguments
    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
    
    // Set up tool-specific environment
    const toolHome = path.join(this.config.cliHomeDir, "tools", toolId);
    if (!fs.existsSync(toolHome)) {
      fs.mkdirSync(toolHome, { recursive: true });
    }

    const env = {
      ...process.env,
      HOME: toolHome,
      USERPROFILE: toolHome, // Windows compatibility
      XDG_CONFIG_HOME: path.join(toolHome, ".config"),
      XDG_DATA_HOME: path.join(toolHome, ".local/share"),
      XDG_CACHE_HOME: path.join(toolHome, ".cache"),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      POCKET_TERMINAL: "1",
      WORKSPACE: this.config.workspaceDir
    };

    // Ensure workspace exists
    if (!fs.existsSync(this.config.workspaceDir)) {
      fs.mkdirSync(this.config.workspaceDir, { recursive: true });
    }

    logger.info(`Spawning PTY for tool: ${toolId} in ${this.config.workspaceDir}`);

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.config.workspaceDir,
      env
    });

    // If it's a specific tool, we might want to launch it immediately
    // but usually we just provide a shell with the right environment.
    if (toolId !== "shell") {
      // Small delay to let shell initialize before sending command
      setTimeout(() => {
        if (toolId === "claude") {
          ptyProcess.write("claude\r");
        } else if (toolId === "gh") {
          ptyProcess.write("gh\r");
        } else if (toolId === "grok") {
          ptyProcess.write("grok\r");
        }
      }, 500);
    }

    this.sessions.set(sessionId, ptyProcess);
    return ptyProcess;
  }

  resize(sessionId, cols, rows) {
    const ptyProcess = this.sessions.get(sessionId);
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (e) {
        logger.error(`Resize failed for session ${sessionId}:`, e);
      }
    }
  }

  kill(sessionId) {
    const ptyProcess = this.sessions.get(sessionId);
    if (ptyProcess) {
      ptyProcess.kill();
      this.sessions.delete(sessionId);
    }
  }
}

module.exports = { PTYManager };