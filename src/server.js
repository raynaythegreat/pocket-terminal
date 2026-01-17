/**
 * Main server entry point for Pocket Terminal.
 * This is the single entry point that initializes and starts the application.
 */

const dotenv = require("dotenv");
dotenv.config();

const { createConfig } = require("./config");
const { createApp } = require("./app");
const { logger } = require("./utils/logger");

function createServer() {
  try {
    // Load configuration
    const config = createConfig();
    logger.info("Configuration loaded successfully");
    
    // Create Express app
    const app = createApp({ config });
    logger.info("Express app created");
    
    // Create HTTP server
    const server = require("http").createServer(app);
    
    // Initialize WebSocket handlers
    const { initializeWebSocket } = require("./terminal/websocket");
    initializeWebSocket(server, { config });
    logger.info("WebSocket handlers initialized");
    
    return { server, config };
  } catch (error) {
    logger.error("Failed to create server:", error);
    throw error;
  }
}

// Start server if run directly
if (require.main === module) {
  const { server, config } = createServer();
  
  server.listen(config.port, () => {
    logger.info(`Pocket Terminal listening on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Workspace: ${config.workspaceDir}`);
  });
  
  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  });
  
  process.on("SIGINT", () => {
    logger.info("Received SIGINT, shutting down gracefully");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  });
}

module.exports = { createServer };