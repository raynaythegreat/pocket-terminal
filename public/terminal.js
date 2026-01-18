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
      foreground: '#f8fafc',
      cursor: '#6366f1',
      selectionBackground: 'rgba(99, 102, 241, 0.3)'
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

  // Standard resize listener
  window.addEventListener('resize', () => fitTerminal());

  // Mobile Keyboard / Visual Viewport handling
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      // Set height based on actual visible space (accounting for keyboard)
      const vh = window.visualViewport.height;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      
      // Scroll to top to prevent the browser from trying to "scroll" the fixed body
      window.scrollTo(0, 0);
      
      setTimeout(fitTerminal, 100);
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
  currentTool = toolId;
  
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
    term.write(`\x1b[1;34m[Pocket Terminal]\x1b[0m Launching \x1b[1;37m${toolId}\x1b[0m...\r\n`);
    fitTerminal();
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        term.write(msg.data);
      }
    } catch (e) {
      // Fallback for raw data
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
  if (!banner || !textEl || !btn) return;
  
  textEl.textContent = text;
  banner.classList.remove('hidden');
  btn.classList.toggle('hidden', !allowRetry);
}

function hideStatus() {
  const banner = document.getElementById('connection-status');
  if (banner) banner.classList.add('hidden');
}

/**
 * UI Navigation
 */
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(screenId).classList.remove('hidden');
  
  if (screenId === 'terminal-screen') {
    initTerminal();
    setTimeout(fitTerminal, 200);
  }
}

// Initialize Launcher
async function loadTools() {
  const loading = document.getElementById('tools-loading');
  const coreGrid = document.getElementById('tools-core');
  const aiGrid = document.getElementById('tools-ai');
  
  try {
    const res = await fetch('/api/tools');
    const tools = await res.json();
    
    loading.classList.add('hidden');
    coreGrid.innerHTML = '';
    aiGrid.innerHTML = '';

    tools.forEach(tool => {
      const card = document.createElement('div');
      card.className = 'tool-card';
      const statusBadge = tool.isAvailable 
        ? '<span class="badge badge-ok">Ready</span>' 
        : `<span class="badge">Install: ${tool.binary}</span>`;
      
      card.innerHTML = `
        <span class="tool-name">${tool.name}</span>
        ${statusBadge}
      `;
      
      card.onclick = () => {
        document.getElementById('active-tool-name').textContent = tool.name;
        switchScreen('terminal-screen');
        connectWebSocket(tool.id);
      };

      if (tool.id === 'shell' || tool.id === 'terminal') {
        coreGrid.appendChild(card);
      } else {
        aiGrid.appendChild(card);
      }
    });
  } catch (err) {
    console.error('Failed to load tools:', err);
  }
}

// Event Listeners
document.getElementById('back-to-launcher').onclick = () => {
  if (ws) ws.close();
  switchScreen('launcher-screen');
};

document.getElementById('reconnect-btn').onclick = () => {
  connectWebSocket(currentTool);
};

document.getElementById('refresh-tools').onclick = () => loadTools();

document.getElementById('terminal-clear').onclick = () => {
  if (term) term.reset();
};

// Initial Load
loadTools();