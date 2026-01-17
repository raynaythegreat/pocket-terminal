let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";

function switchToScreen(id) {
  document.getElementById("launcher-screen").classList.toggle("hidden", id !== "launcher-screen");
  document.getElementById("terminal-screen").classList.toggle("hidden", id !== "terminal-screen");
  if (id === "terminal-screen") {
    setTimeout(() => {
      if (fitAddon) fitAddon.fit();
    }, 100);
  }
}

function initTerminal() {
  if (term) return;
  
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
    theme: { background: '#000000', foreground: '#f8fafc' },
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

  window.addEventListener('resize', () => fitAddon.fit());
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
  switchToScreen('terminal-screen');
  initTerminal();
  term.clear();
  
  if (ws) ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}?tool=${toolId}`);

  ws.onmessage = (ev) => term.write(ev.data);
  ws.onopen = () => {
    fitAddon.fit();
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };
}

async function copyTerminalContent() {
  if (!term) return;
  term.selectAll();
  const text = term.getSelection();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copy-terminal');
    const originalText = btn.querySelector('span').innerText;
    btn.querySelector('span').innerText = 'Copied!';
    setTimeout(() => {
      btn.querySelector('span').innerText = originalText;
      term.clearSelection();
    }, 2000);
  } catch (err) {
    console.error('Failed to copy', err);
  }
}

document.getElementById('back-to-launcher').onclick = () => {
  if (ws) ws.close();
  switchToScreen('launcher-screen');
};

document.getElementById('copy-terminal').onclick = copyTerminalContent;
document.getElementById('refresh-tools').onclick = fetchTools;

// Initial load
fetchTools();