let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";

// Set app height for mobile viewport
function setAppHeightVar() {
  const vv = window.visualViewport;
  const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.floor(h)}px`);
}

function scheduleFit() {
  if (!term || !fitAddon) return;
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    } catch (e) {
      console.warn("Terminal fit error:", e);
    }
  });
}

function switchToScreen(id) {
  document.getElementById("launcher-screen").classList.toggle("hidden", id !== "launcher-screen");
  document.getElementById("terminal-screen").classList.toggle("hidden", id !== "terminal-screen");
  if (id === "terminal-screen") setTimeout(scheduleFit, 50);
}

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
}

async function fetchTools() {
  try {
    const res = await fetch('/api/tools');
    const tools = await res.json();
    const coreGrid = document.getElementById('tools-core');
    const aiGrid = document.getElementById('tools-ai');
    coreGrid.innerHTML = '';
    aiGrid.innerHTML = '';

    tools.forEach(tool => {
      const card = document.createElement('div');
      card.className = `tool-card ${tool.ready ? '' : 'disabled'}`;
      card.innerHTML = `
        <div class="tool-name">${tool.name}</div>
        <div class="badge ${tool.ready ? 'badge-ok' : ''}">${tool.ready ? 'Ready' : 'Not Found'}</div>
      `;
      if (tool.ready) {
        card.onclick = () => runTool(tool.id, tool.name);
      }
      (tool.category === 'core' ? coreGrid : aiGrid).appendChild(card);
    });
    document.getElementById('tools-loading').classList.add('hidden');
  } catch (err) {
    console.error('Failed to fetch tools', err);
  }
}

function runTool(toolId, toolName) {
  currentTool = toolId;
  document.getElementById('active-tool-name').textContent = toolName;
  initTerminal();
  term.clear();
  
  if (ws) ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}?tool=${toolId}`);

  ws.onmessage = (ev) => term.write(ev.data);
  ws.onclose = () => {
    term.write('\r\n\x1b[31mConnection closed.\x1b[0m\r\n');
  };
  ws.onerror = () => {
    term.write('\r\n\x1b[31mConnection error.\x1b[0m\r\n');
  };

  switchToScreen('terminal-screen');
}

// Event Listeners
window.addEventListener('resize', scheduleFit);
window.visualViewport?.addEventListener('resize', () => {
  setAppHeightVar();
  scheduleFit();
});

document.getElementById('back-to-launcher').onclick = () => {
  if (ws) ws.close();
  switchToScreen('launcher-screen');
};

document.getElementById('clear-term').onclick = () => term?.clear();

document.querySelectorAll('.kbd-btn').forEach(btn => {
  btn.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const key = btn.dataset.key;
    const map = {
      'tab': '\t', 'esc': '\x1b', 'ctrl-c': '\x03',
      'up': '\x1b[A', 'down': '\x1b[B'
    };
    ws.send(JSON.stringify({ type: 'input', data: map[key] }));
  };
});

document.getElementById('open-help').onclick = () => document.getElementById('help-modal').classList.remove('hidden');
document.getElementById('close-help').onclick = () => document.getElementById('help-modal').classList.add('hidden');
document.getElementById('refresh-tools').onclick = fetchTools;

// Startup
setAppHeightVar();
fetchTools();