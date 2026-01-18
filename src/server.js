/**
 * Main entry point for the Pocket Terminal server.
 */
const http = require("http");
const config = require("./config");
const { createApp } = require("./app/index");
const { createSessionStore } = require("./auth/sessionStore");
const { setupWebSocket } = require("./terminal/websocket");
const { logger } = require("./utils/logger");

function createServer() {
  const sessionStore = createSessionStore();
  
  const app = createApp({ config, sessionStore });
  const server = http.createServer(app);

  // Initialize WebSockets
  setupWebSocket(server, { config, sessionStore });

  const port = config.port;

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Pocket Terminal running at http://localhost:${port}`);
    if (config.auth.password) {
      logger.info("Authentication: Enabled");
    } else {
      logger.warn("Authentication: Disabled (No APP_PASSWORD set)");
    }
  });

  return { server, app, sessionStore };
}

// Start the server if this file is run directly
if (require.main === module) {
  try {
    createServer();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

module.exports = { createServer };