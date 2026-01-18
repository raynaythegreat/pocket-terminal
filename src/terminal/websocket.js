const { WebSocketServer } = require("ws");
const { PtyManager } = require("./ptyManager");
const { handleTerminalSession } = require("./wsHandler");
const { logger } = require("../utils/logger");
const { isValidSession } = require("../auth/sessionStore");

/**
 * Sets up the WebSocket server for terminal handling.
 */
function setupTerminalWebSocket(server, { config, sessionStore }) {
  const wss = new WebSocketServer({ noServer: true });
  const ptyManager = new PtyManager(config);

  // Handle the HTTP upgrade manually to check authentication
  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname.startsWith("/terminal/")) {
      const toolId = pathname.split("/")[2];
      
      // Simple auth check via cookies
      const cookies = request.headers.cookie || "";
      const sessionToken = cookies.split('; ')
        .find(row => row.startsWith('session_token='))
        ?.split('=')[1];

      // If a password is set but session is invalid, reject the upgrade
      if (config.auth.password && !isValidSession(sessionStore, sessionToken)) {
        logger.warn(`Unauthorized WS upgrade attempt for ${toolId}`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const ptyProcess = ptyManager.spawn(toolId);
        handleTerminalSession(ws, ptyProcess);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}

module.exports = { setupTerminalWebSocket };