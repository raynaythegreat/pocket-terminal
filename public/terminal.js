let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let isConnecting = false;

/**
 * Initializes the xterm.js instance
 */
function initTerminal() {
  if (term) return;

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
    theme: {
      background: '#000000',
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

  // Handle standard resize
  window.addEventListener('resize', () => fitTerminal());

  // Handle Mobile Keyboard / Viewport changes
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      // Adjust the app height variable for CSS
      document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
      fitTerminal();
    });
  }
}

/**
 * Fits the terminal to its container and notifies the backend
 */
function fitTerminal() {
  if (!fitAddon || !term) return;
  try {
    fitAddon.fit();
    const { cols, rows } = term;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  } catch (e) {
    console.error('Fit error:', e);
  }
}

/**
 * Connects to the backend WebSocket for a specific tool
 */
function connectWebSocket(toolId) {
  if (isConnecting) return;
  isConnecting = true;
  
  if (ws) {
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/terminal/${toolId}`;
  
  showStatus('Connecting...');
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    isConnecting = false;
    hideStatus();
    term.reset();
    term.write(`\x1b[1;32mConnected to ${toolId}\x1b[0m\r\n`);
    fitTerminal();
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        term.write(msg.data);
      }
    } catch (e) {
      // Handle raw data if not JSON (fallback)
      term.write(event.data);
    }
  };
  
  ws.onclose = () => {
    isConnecting = false;
    showStatus('Disconnected. Tap to reconnect', true);
  };

  ws.onerror = () => {
    isConnecting = false;
    showStatus('Connection Error', true);
  };
}

function showStatus(text, allowRetry = false) {
  const banner = document.getElementById('connection-status');
  const textEl = document.getElementById('connection-text');
  const btn = document.getElementById('reconnect-btn');
  textEl.textContent = text;
  banner.classList.remove('hidden');
  btn.classList.toggle('hidden', !allowRetry);
}

function hideStatus() {
  document.getElementById('connection-status').classList.add('hidden');
}

function switchToScreen(id) {
  document.getElementById("launcher-screen").classList.toggle("hidden", id !== "launcher-screen");
  document.getElementById("terminal-screen").classList.toggle("hidden", id !== "terminal-screen");
  if (id === "terminal-screen") {
    setTimeout(fitTerminal, 100);
  }
}

// Global Launch Function
window.launchTool = (toolId) => {
  currentTool = toolId;
  document.getElementById('terminal-title').textContent = toolId;
  initTerminal();
  switchToScreen('terminal-screen');
  connectWebSocket(toolId);
};

// Event Listeners
document.getElementById('back-to-launcher').addEventListener('click', () => {
  if (ws) ws.close();
  switchToScreen('launcher-screen');
});

document.getElementById('reconnect-btn').addEventListener('click', () => {
  connectWebSocket(currentTool);
});

// Initial Tool Loading
async function loadTools() {
  try {
    const res = await fetch('/api/tools');
    const tools = await res.json();
    const container = document.getElementById('tools-ai');
    const coreContainer = document.getElementById('tools-core');
    
    document.getElementById('tools-loading').classList.add('hidden');
    
    // Core Terminal
    coreContainer.innerHTML = `
      <div class="tool-card" onclick="launchTool('shell')">
        <span class="tool-name">Standard Terminal</span>
        <span class="badge badge-ok">Ready</span>
      </div>
    `;

    // AI Tools
    container.innerHTML = tools.map(t => `
      <div class="tool-card" onclick="launchTool('${t.id}')">
        <span class="tool-name">${t.name}</span>
        <span class="badge ${t.isAvailable ? 'badge-ok' : ''}">${t.isAvailable ? 'Ready' : 'Not Found'}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load tools', err);
  }
}

window.addEventListener('DOMContentLoaded', loadTools);