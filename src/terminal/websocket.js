const WebSocket = require('ws');
const { logger } = require('../utils/logger');

function createWebSocketServer(server, ptyManager, sessionStore) {
  const wss = new WebSocket.Server({ server, path: '/terminal/' });

  wss.on('connection', (ws, req) => {
    const toolId = req.url.split('/').pop();
    const sessionId = req.headers['cookie']?.split(';')
      .find(c => c.trim().startsWith('sessionId='))
      ?.split('=')[1];

    if (!sessionStore.isValidSession(sessionId)) {
      logger.warn(`Invalid session attempt for tool: ${toolId}`);
      return ws.close(4001, 'Unauthorized');
    }

    logger.debug(`New WebSocket connection for ${toolId}`);
    const pty = ptyManager.createSession(toolId);
    
    // Heartbeat handler
    let heartbeatTimeout;
    function resetHeartbeat() {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        logger.debug(`Heartbeat timeout for ${toolId}`);
        ws.close(4002, 'Heartbeat timeout');
      }, 45000); // 45s timeout (30s heartbeat + buffer)
    }
    resetHeartbeat();

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        
        if (msg.type === 'heartbeat') {
          resetHeartbeat();
          return;
        }

        if (msg.type === 'resize') {
          pty.resize(msg.cols, msg.rows);
          return;
        }

        if (msg.type === 'input') {
          pty.write(msg.data);
        }
      } catch (error) {
        logger.error('WebSocket message error:', error);
      }
    });

    pty.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    ws.on('close', () => {
      logger.debug(`WebSocket closed for ${toolId}`);
      clearTimeout(heartbeatTimeout);
      ptyManager.cleanupSession(toolId);
    });

