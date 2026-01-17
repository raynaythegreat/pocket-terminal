/**
 * Terminal session management.
 * Handles individual terminal sessions and PTY operations.
 */

const { logger } = require("../utils/logger");
const { createPtyManager } = require("./manager");

function createTerminalSession(toolId, { config }) {
  let ptyManager = null;
  let isActive = false;

  const session = {
    toolId,
    
    async initialize() {
      try {
        ptyManager = createPtyManager(toolId, { config });
        await ptyManager.start();
        isActive = true;
        logger.info(`Terminal session initialized for tool: ${toolId}`);
      } catch (error) {
        logger.error(`Failed to initialize terminal session for ${toolId}:`, error);
        throw error;
      }
    },

    handleMessage(message, ws) {
      if (!isActive) {
        ws.send(JSON.stringify({ 
          type: "error", 
          message: "Terminal session not active" 
        }));
        return;
      }

      switch (message.type) {
        case "input":
          ptyManager.write(message.data);
          break;
          
        case "resize":
          if (message.cols && message.rows) {
            ptyManager.resize(message.cols, message.rows);
          }
          break;
          
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
          
        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }
    },

    cleanup() {
      if (ptyManager) {
        ptyManager.destroy();
        ptyManager = null;
      }
      isActive = false;
      logger.info(`Terminal session cleaned up for tool: ${toolId}`);
    }
  };

  // Auto-initialize
  session.initialize().catch(error => {
    logger.error(`Auto-initialization failed for ${toolId}:`, error);
  });

  return session;
}

module.exports = { createTerminalSession };