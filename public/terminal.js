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

  window.addEventListener('resize', () => requestFitSoon());

  // iOS Safari: viewport changes when address bar collapses or keyboard opens.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => requestFitSoon());
    window.visualViewport.addEventListener('scroll', () => requestFitSoon());
  }
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
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', tool.ready ? '0' : '-1');
      card.innerHTML = `
        <div class="tool-name">${tool.name}</div>
        <div class="badge ${tool.ready ? 'badge-ok' : ''}">${tool.ready ? 'Ready' : 'Not Found'}</div>
      `;
      if (tool.ready) {
        card.onclick = () => runTool(tool.id, tool.name);
        card.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            runTool(tool.id, tool.name);
          }
        };
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
  const nameEl = document.getElementById('active-tool-name');
  if (nameEl) nameEl.textContent = toolName;

  switchToScreen('terminal-screen');
  initTerminal();

  term.clear();

  if (ws) ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}?tool=${encodeURIComponent(toolId)}`);

  ws.onmessage = (ev) => term.write(ev.data);
  ws.onopen = () => {
    requestFitSoon();
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN && term) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 80);
  };
}

async function copyTerminalContent() {
  if (!term) return;

  let text = term.getSelection();
  if (!text) {
    term.selectAll();
    text = term.getSelection();
  }

  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copy-terminal');
    if (btn) {
      const label = btn.querySelector('span');
      const originalText = label ? label.textContent : '';
      if (label) label.textContent = 'Copied';
      setTimeout(() => {
        if (label) label.textContent = originalText || 'Copy';
      }, 900);
    }
  } catch (err) {
    console.error('Clipboard copy failed', err);
  } finally {
    try { term.clearSelection(); } catch (_) {}
  }
}

function clearTerminal() {
  if (!term) return;
  term.clear();
}

function goBack() {
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  switchToScreen('launcher-screen');
}

// Wire up UI controls (if present)
document.addEventListener('DOMContentLoaded', () => {
  fetchTools();

  const refreshBtn = document.getElementById('refresh-tools');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    document.getElementById('tools-loading')?.classList.remove('hidden');
    fetchTools();
  });

  const backBtn = document.getElementById('back-to-launcher');
  if (backBtn) backBtn.addEventListener('click', goBack);

  const copyBtn = document.getElementById('copy-terminal');
  if (copyBtn) copyBtn.addEventListener('click', copyTerminalContent);

  const clearBtn = document.getElementById('clear-terminal');
  if (clearBtn) clearBtn.addEventListener('click', clearTerminal);

  // Fit when coming back from background (mobile)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestFitSoon();
  });
});