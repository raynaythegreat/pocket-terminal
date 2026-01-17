let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let reconnectTimeout = null;
let isConnecting = false;

function switchToScreen(id) {
  document.getElementById("launcher-screen").classList.toggle("hidden", id !== "launcher-screen");
  document.getElementById("terminal-screen").classList.toggle("hidden", id !== "terminal-screen");
  if (id === "terminal-screen") {
    setTimeout(() => {
      if (fitAddon) fitAddon.fit();
    }, 100);
  }
}

function requestFitSoon() {
  if (!fitAddon) return;
  // Defer to allow layout to settle (especially after iOS viewport changes)
  setTimeout(() => {
    try { fitAddon.fit(); } catch (_) {}
  }, 50);
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

  term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => requestFitSoon());

  // iOS Safari: viewport changes when address bar collapses or keyboard opens.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => requestFitSoon());
    window.visualViewport.addEventListener('scroll', () => requestFitSoon());
  }
}

function showConnectionStatus(text, showReconnect = false) {
  const banner = document.getElementById('connection-status');
  const textEl = document.getElementById('connection-text');
  const reconnectBtn = document.getElementById('reconnect-btn');
  
  textEl.textContent = text;
  banner.classList.remove('hidden');
  reconnectBtn.classList.toggle('hidden', !showReconnect);
}

function hideConnectionStatus() {
  const banner = document.getElementById('connection-status');
  banner.classList.add('hidden');
}

function connectWebSocket(toolId) {
  if (isConnecting) return;
  isConnecting = true;
  
  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/terminal/${toolId}`;
  
  showConnectionStatus('Connecting...');
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    isConnecting = false;
    hideConnectionStatus();
    console.log('WebSocket connected');
    
    // Send initial terminal size
    if (fitAddon) {
      const { cols, rows } = fitAddon;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        term.write(msg.data);
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  };
  
  ws.onclose = () => {
    isConnecting = false;
    console.log('WebSocket disconnected');
    showConnectionStatus('Disconnected', true);
    
    // Auto-reconnect after 3 seconds
    reconnectTimeout = setTimeout(() =>