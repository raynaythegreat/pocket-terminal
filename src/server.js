const http = require("http");
const { createApp } = require("./app/index");
const { loadConfig } = require("./config/index");
const { createSessionStore } = require("./auth/sessionStore");
const { setupTerminalWebSocket } = require("./terminal/websocket");
const { logger } = require("./utils/logger");

/**
 * Main server entry point.
 */
function createServer() {
  const config = loadConfig();
  const sessionStore = createSessionStore();
  
  const app = createApp({ config, sessionStore });
  const server = http.createServer(app);

  // Attach Terminal WebSockets
  setupTerminalWebSocket(server, { config, sessionStore });

  const port = process.env.PORT || 3000;
  
  server.listen(port, () => {
    logger.info(`Pocket Terminal running at http://localhost:${port}`);
    if (config.auth.password) {
      logger.info(`Auth enabled (Hint: ${config.auth.hint})`);
    } else {
      logger.warn(`No password set. App is PUBLIC.`);
    }
  });

  return { server, app, config };
}

if (require.main === module) {
  createServer();
}

module.exports = { createServer };