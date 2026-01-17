let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;
let inputQueue = [];
let resizeDebounce = null;
let heartbeatInterval = null;

function switchToScreen(id) {
  document.getElementById("launcher-screen").classList.toggle("hidden", id !== "launcher-screen");
  document.getElementById("terminal-screen").classList.toggle("hidden", id !== "terminal-screen");
  if (id === "terminal-screen") {
    setTimeout(() => {
      if (fitAddon) fitAddon.fit();
    }, 100);
  }
}

function handleViewportChange() {
  if (resizeDebounce) clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    if (!fitAddon) return;
    try {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        const { cols, rows } = fitAddon;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    } catch (error) {
      console.warn('Viewport resize error:', error);
    }
  }, 200);
}

function initTerminal() {
  if (term) return;

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
    theme: {
      background: 'transparent',
      foreground: '#f8fafc'
    },
    allowProposedApi: true
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();

  term.onData(data => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    } else {
      inputQueue.push(data);
    }
  });

  window.addEventListener('resize', handleViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange);
  }
}

function setupHeartbeat() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }, 30000);
}

function showConnectionStatus(text, showReconnect = false) {
  const banner = document.getElementById('connection-status');
  const textEl = document.getElementById('connection-text');
  const reconnectBtn = document.getElementById('reconnect-btn');
  
  textEl.textContent = text;
  banner.classList.remove('hidden');
  reconnectBtn.classList.toggle('hidden', !showReconnect);

  // Make banner more accessible
  banner.setAttribute('aria-live', 'assertive');
  banner.setAttribute('role', 'alert');
}

function connectWebSocket(toolId) {
  if (ws) {
    ws.close();
    clearInterval(heartbeatInterval);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/terminal/${toolId}`;
  
  showConnectionStatus('Connecting...');
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    reconnectAttempts = 0;
    showConnectionStatus('Connected', false);
    setupHeartbeat();
    
    if (fitAddon) {
      const { cols, rows } = fitAddon;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }

    // Send queued input
    while (inputQueue.length > 0) {
      ws.send(JSON.stringify({ type: 'input', data: inputQueue.shift() }));
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        term.write(msg.data);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  };
  
  ws.onclose = (event) => {
    if (event.code !== 1000) {
      const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), 30000);
      showConnectionStatus(`Disconnected (Reconnecting in ${delay/1000}s...)`, true);
      
      reconnectAttempts++;
      if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => connectWebSocket(toolId), delay);
      }
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showConnectionStatus('Connection error', true);
  };
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initTerminal();
  
  document.getElementById('reconnect-btn').addEventListener('click', () => {
    connectWebSocket(currentTool);
  });

  document.getElementById('back-to-launcher').addEventListener('click', () => {
    if (ws) ws.close();
    switchToScreen('launcher-screen');
  });
});