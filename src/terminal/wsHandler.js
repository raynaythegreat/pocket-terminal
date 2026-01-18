const { logger } = require("../utils/logger");

function createWSHandler({ ptyManager, sessionId, toolId }) {
  // Spawn the PTY for this session
  const ptyProcess = ptyManager.spawn(sessionId, toolId);

  return (ws) => {
    logger.info(`WebSocket connection established for tool: ${toolId}`);

    // Send PTY output to WebSocket
    ptyProcess.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    // Handle incoming messages from WebSocket
    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message);
        
        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            ptyManager.resize(sessionId, msg.cols, msg.rows);
            break;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          default:
            logger.warn(`Unknown message type: ${msg.type}`);
        }
      } catch (e) {
        // Handle raw string input if it's not JSON
        ptyProcess.write(message.toString());
      }
    });

    // Clean up on close
    ws.on("close", () => {
      logger.info(`WebSocket closed for session ${sessionId}`);
      // We keep the PTY alive for a short grace period or kill it
      // For mobile, it's better to kill to save resources on Render
      ptyManager.kill(sessionId);
    });

    ws.on("error", (err) => {
      logger.error(`WebSocket error in session ${sessionId}:`, err);
      ptyManager.kill(sessionId);
    });
  };
}

module.exports = { createWSHandler };