const pty = require("node-pty");
const path = require("path");
const fs = require("fs");
const { getPaths } = require("../config/paths");

/**
 * Manages Pseudo-Terminal (PTY) instances for various tools.
 */
class PtyManager {
  constructor(config) {
    this.config = config;
    this.paths = getPaths(config);
  }

  /**
   * Spawns a new PTY for a specific tool.
   * @param {string} toolId - The ID of the tool to launch
   * @param {object} dims - {cols, rows} terminal dimensions
   */
  spawn(toolId, dims = { cols: 80, rows: 24 }) {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    
    // Determine command and specific environment
    const { command, env } = this._getToolConfig(toolId);

    const ptyProcess = pty.spawn(shell, ["-c", command], {
      name: "xterm-256color",
      cols: dims.cols || 80,
      rows: dims.rows || 24,
      cwd: this.paths.workspaceDir,
      env: {
        ...process.env,
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
      },
    });

    return ptyProcess;
  }

  _getToolConfig(toolId) {
    // Default: local shell
    let command = "bash";
    let toolHome = path.join(this.paths.cliHomeDir, "tools", "default");

    if (toolId === "claude") {
      command = "claude";
      toolHome = path.join(this.paths.cliHomeDir, "tools", "claude");
    } else if (toolId === "copilot" || toolId === "gh") {
      command = "gh copilot suggest";
      toolHome = path.join(this.paths.cliHomeDir, "tools", "gh");
    } else if (toolId === "grok") {
      command = "grok";
      toolHome = path.join(this.paths.cliHomeDir, "tools", "grok");
    } else if (toolId === "gemini") {
      command = "gemini";
      toolHome = path.join(this.paths.cliHomeDir, "tools", "gemini");
    } else if (toolId !== "shell") {
      // Try generic launcher if tool is recognized but not specifically mapped
      command = toolId;
      toolHome = path.join(this.paths.cliHomeDir, "tools", toolId);
    }

    // Ensure the tool-specific home exists for persistence
    if (!fs.existsSync(toolHome)) {
      fs.mkdirSync(toolHome, { recursive: true });
    }

    return {
      command,
      env: {
        HOME: toolHome,
        XDG_CONFIG_HOME: path.join(toolHome, ".config"),
        XDG_DATA_HOME: path.join(toolHome, ".local", "share"),
        XDG_CACHE_HOME: path.join(toolHome, ".cache"),
      },
    };
  }
}

module.exports = { PtyManager };