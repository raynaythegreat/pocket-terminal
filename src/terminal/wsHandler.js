const { logger } = require("../utils/logger");
const { getSession } = require("./manager");

/**
 * Handles terminal WebSocket connections.
 * This is called from the WebSocket server when a new connection is established.
 */
function handleTerminalWS(ws, toolId, req) {
  logger.info(`Terminal WS connection: ${toolId}`);

  // Create or get existing PTY session for this tool
  const session = getSession(toolId);

  // Send initial data if any (though usually empty for new sessions)
  if (session.outputBuffer) {
    ws.send(JSON.stringify({ type: 'data', data: session.outputBuffer }));
  }

  // Handle data from PTY to WebSocket
  const onData = (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }));
    }
  };

  // Add listener and keep track of it to remove on close
  session.pty.onData(onData);

  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      if (msg.type === 'input') {
        session.pty.write(msg.data);
      } else if (msg.type === 'resize') {
        const { cols, rows } = msg;
        if (cols && rows) {
          session.pty.resize(cols, rows);
        }
      }
    } catch (err) {
      logger.error('WS Message Error:', err);
    }
  });

  // Cleanup on close
  ws.on('close', () => {
    logger.info(`Terminal WS closed: ${toolId}`);
    // We don't necessarily kill the PTY immediately to allow reattachment
    // but we must remove the data listener to prevent memory leaks/duplicate sends
    session.pty.removeListener('data', onData);
  });

  ws.on('error', (err) => {
    logger.error(`WS Error (${toolId}):`, err);
  });
}

module.exports = { handleTerminalWS };