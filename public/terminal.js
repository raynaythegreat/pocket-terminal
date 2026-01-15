let socket;
let term;
let fitAddon;
let sessionToken = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// Optimized Terminal Theme to match UI
const terminalTheme = {
  background: '#09090b',
  foreground: '#fafafa',
  cursor: '#6366f1',
  cursorAccent: '#09090b',
  selection: 'rgba(99, 102, 241, 0.3)',
  black: '#18181b',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#8b5cf6',
  cyan: '#06b6d4',
  white: '#fafafa',
  brightBlack: '#71717a',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#a78bfa',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff'
};

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  
  if (id === 'terminal-screen' && term) {
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);
  }
}

async function handleLogin(e) {
  if (e) e.preventDefault();
  const passwordInput = document.getElementById('password');
  const password = passwordInput ? passwordInput.value : '';
  const errorEl = document.getElementById('login-error');
  
  try {
    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    const data = await res.json();
    if (data.success) {
      sessionToken = data.token;
      sessionStorage.setItem("pocket_token", sessionToken);
      if (errorEl) errorEl.textContent = "";
      connect(sessionToken);
    } else {
      if (errorEl) errorEl.textContent = "Invalid password. Access denied.";
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = "Server connection failed.";
  }
}

function connect(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    reconnectAttempts = 0;
    socket.send(JSON.stringify({ type: "auth", token: token }));
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) dot.className = 'dot online';
    if (text) text.textContent = 'CONNECTED';
  };

  socket.onclose = () => {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) dot.className = 'dot offline';
    if (text) text.textContent = 'DISCONNECTED';
    if (sessionToken) scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    showToast("Connection error", "error");
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "authenticated":
          showScreen("launcher-screen");
          loadProjects();
          initTerminal();
          break;
        case "terminal_output":
          if (term) term.write(data.data);
          break;
        case "error":
          showToast(data.message, "error");
          if (data.message === "Invalid session") logout();
          break;
      }
    } catch (e) {
      console.error("Msg Error", e);
    }
  };
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  showToast(`Reconnecting in ${delay/1000}s...`, "warning");
  setTimeout(() => {
    if (sessionToken) connect(sessionToken);
  }, delay);
}

function initTerminal() {
  if (term) return;

  term = new Terminal({
    theme: terminalTheme,
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
    convertEol: true,
    allowProposedApi: true
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();

  term.onData(data => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "terminal_input", data }));
    }
  });

  window.addEventListener('resize', () => {
    fitAddon.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "resize",
        cols: term.cols,
        rows: term.rows
      }));
    }
  });
}

function launchCLI(tool, args = []) {
  const project = document.getElementById('project-select').value;
  showScreen('terminal-screen');
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "spawn",
      project: project,
      cols: term.cols,
      rows: term.rows
    }));
    
    // Auto-run the tool command
    const cmd = tool + " " + args.join(" ") + "\n";
    setTimeout(() => {
      socket.send(JSON.stringify({ type: "terminal_input", data: cmd }));
    }, 500);
  }
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': sessionToken }
    });
    const projects = await res.json();
    const select = document.getElementById('project-select');
    if (!select) return;

    select.innerHTML = '<option value="">Root Environment</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Load projects failed");
  }
}

async function cloneRepo() {
  const repoUrl = prompt("Enter Git Repository URL:");
  if (!repoUrl) return;

  showToast("Cloning repository...", "info");
  try {
    const res = await fetch('/api/clone', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': sessionToken
      },
      body: JSON.stringify({ repoUrl })
    });
    const data = await res.json();
    if (data.success) {
      showToast("Repository cloned successfully!", "success");
      loadProjects();
    } else {
      showToast("Clone failed: " + data.error, "error");
    }
  } catch (err) {
    showToast("Network error during clone", "error");
  }
}

function logout() {
  sessionToken = null;
  sessionStorage.removeItem("pocket_token");
  if (socket) socket.close();
  showScreen('login-screen');
}

// Global App Init
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  const savedToken = sessionStorage.getItem("pocket_token");
  if (savedToken) {
    sessionToken = savedToken;
    connect(sessionToken);
  } else {
    showScreen('login-screen');
  }
});