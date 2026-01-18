const { logger } = require("../utils/logger");

/**
 * Handles the logic for a single WebSocket terminal session.
 */
function handleTerminalSession(ws, ptyProcess) {
  logger.info(`Terminal session started (PID: ${ptyProcess.pid})`);

  // Stream PTY output to WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }));
    }
  });

  // Handle incoming WebSocket messages
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        const { cols, rows } = msg;
        if (cols && rows) {
          ptyProcess.resize(cols, rows);
        }
      }
    } catch (err) {
      logger.error('WS Message Error:', err);
    }
  });

  // Clean up on close
  ws.on('close', () => {
    logger.info(`Terminal session closed (PID: ${ptyProcess.pid})`);
    try {
      // Wait a moment before killing to allow cleanup
      setTimeout(() => {
        ptyProcess.kill();
      }, 1000);
    } catch (e) {
      // Already dead
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    logger.info(`PTY Process exited with code ${exitCode}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'data', 
        data: `\r\n\x1b[1;31mProcess exited (code: ${exitCode})\x1b[0m\r\n` 
      }));
      // Close the socket shortly after process ends
      setTimeout(() => ws.close(), 2000);
    }
  });
}

module.exports = { handleTerminalSession };