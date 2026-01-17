/**
 * WebSocket handling for terminal connections.
 * Manages WebSocket connections and terminal sessions.
 */

const WebSocket = require("ws");
const { logger } = require("../utils/logger");
const { createTerminalSession } = require("./session");

const sessions = new Map();

function initializeWebSocket(server, { config }) {
  const wss = new WebSocket.Server({ 
    server,
    path: "/terminal"
  });

  wss.on("connection", (ws, req) => {
    // Extract tool ID from URL path
    const urlParts = req.url.split("/");
    const toolId = urlParts[urlParts.length - 1] || "shell";
    
    logger.info(`New WebSocket connection for tool: ${toolId}`);
    
    // Create terminal session
    const session = createTerminalSession(toolId, { config });
    sessions.set(ws, session);
    
    // Handle WebSocket messages
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        session.handleMessage(message, ws);
      } catch (error) {
        logger.error("Failed to parse WebSocket message:", error);
        ws.send(JSON.stringify({ 
          type: "error", 
          message: "Invalid message format" 
        }));
      }
    });
    
    // Handle WebSocket close
    ws.on("close", () => {
      logger.info(`WebSocket connection closed for tool: ${toolId}`);
      const session = sessions.get(ws);
      if (session) {
        session.cleanup();
        sessions.delete(ws);
      }
    });
    
    // Handle WebSocket errors
    ws.on("error", (error) => {
      logger.error("WebSocket error:", error);
    });
    
    // Send initial terminal size if available
    ws.send(JSON.stringify({ 
      type: "ready", 
      toolId,
      message: "Terminal session established" 
    }));
  });

  // Cleanup on server shutdown
  process.on("SIGTERM", () => {
    wss.close();
    sessions.forEach(session => session.cleanup());
  });

  logger.info("WebSocket server initialized");
  return wss;
}

module.exports = { initializeWebSocket };