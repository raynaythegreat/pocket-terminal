/**
 * PTY (pseudo-terminal) management.
 * Handles the creation and management of terminal processes.
 */

const pty = require("node-pty");
const { logger } = require("../utils/logger");

function createPtyManager(toolId, { config }) {
  let ptyProcess = null;
  let onDataCallback = null;

  const manager = {
    toolId,
    
    async start() {
      try {
        // Determine the command to run based on tool ID
        const command = this.getCommandForTool(toolId);
        
        // Create PTY process
        ptyProcess = pty.spawn(command.command, command.args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: config.workspaceDir,
          env: this.getEnvironmentForTool(toolId, config),
        });

        // Set up data handler
        ptyProcess.on("data", (data) => {
          if (onDataCallback) {
            onDataCallback(data);
          }
        });

        // Handle process exit
        ptyProcess.on("exit", (code, signal) => {
          logger.info(`PTY process exited for ${toolId} with code ${code}, signal ${signal}`);
        });

        logger.info(`PTY process started for tool: ${toolId}`);
      } catch (error) {
        logger.error(`Failed to start PTY process for ${toolId}:`, error);
        throw error;
      }
    },

    getCommandForTool(toolId) {
      // Tool-specific command mapping
      const toolCommands = {
        "shell": {
          command: config.terminal.defaultShell,
          args: []
        },
        "copilot": {
          command: "gh",
          args: ["copilot", "launch"]
        },
        "gemini": {
          command: "gemini",
          args: []
        },
        "grok": {
          command: "grok",
          args: []
        },
        "claude": {
          command: "claude-code",
          args: []
        }
      };

      return toolCommands[toolId] || toolCommands["shell"];
    },

    getEnvironmentForTool(toolId, config) {
      const baseEnv = { ...process.env };
      
      // Set up tool-specific HOME directory
      const toolHomeDir = `${config.cliHomeDir}/tools/${toolId}`;
      baseEnv.HOME = toolHomeDir;
      
      // Set XDG directories for better CLI compatibility
      baseEnv.XDG_CONFIG_HOME = `${toolHomeDir}/.config`;
      baseEnv.XDG_DATA_HOME = `${toolHomeDir}/.local/share`;
      baseEnv.XDG_CACHE_HOME = `${toolHomeDir}/.cache`;
      
      return baseEnv;
    },

    write(data) {
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    },

    resize(cols, rows) {
      if (ptyProcess) {
        ptyProcess.resize(cols, rows);
      }
    },

    destroy() {
      if (ptyProcess) {
        ptyProcess.destroy();
        ptyProcess = null;
      }
    },

    onData(callback) {
      onDataCallback = callback;
    }
  };

  return manager;
}

module.exports = { createPtyManager };