let socket;
let term;
let fitAddon;
let sessionToken = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// Optimized Terminal Theme
const terminalTheme = {
  background: '#000000',
  foreground: '#fafafa',
  cursor: '#6366f1',
  cursorAccent: '#000000',
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
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  
  if (id === 'terminal-screen' && term) {
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('password').value;
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
      connect(sessionToken);
    } else {
      errorEl.textContent = "Invalid password. Access denied.";
    }
  } catch (err) {
    errorEl.textContent = "Server connection failed.";
  }
}

function connect(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    reconnectAttempts = 0;
    socket.send(JSON.stringify({ type: "auth", token: token }));
    document.getElementById('status-dot').className = 'dot online';
    document.getElementById('status-text').textContent = 'CONNECTED';
  };

  socket.onclose = () => {
    document.getElementById('status-dot').className = 'dot offline';
    document.getElementById('status-text').textContent = 'DISCONNECTED';
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
          break;
        case "error":
          showToast(data.message, "error");
          if (data.message.toLowerCase().includes("auth") || data.message.toLowerCase().includes("session")) {
            logout();
          }
          break;
        case "data":
          if (term) term.write(data.data);
          break;
      }
    } catch (e) {
      console.error("Error parsing message", e);
    }
  };
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  setTimeout(() => {
    if (sessionToken) connect(sessionToken);
  }, delay);
}

function initTerminal() {
  if (term) return;
  
  term = new Terminal({
    theme: terminalTheme,
    fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
    fontSize: 14,
    cursorBlink: true,
    allowProposedApi: true
  });
  
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  
  term.onData(data => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  window.addEventListener('resize', () => fitAddon.fit());
}

function launchCLI(tool, args = []) {
  const project = document.getElementById('project-select').value;
  document.getElementById('term-title').textContent = `${tool}${project ? ' @ ' + project : ''}`;
  
  initTerminal();
  showScreen("terminal-screen");
  
  const command = args.length > 0 ? `${tool} ${args.join(' ')}` : tool;
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    term.reset();
    socket.send(JSON.stringify({
      type: "spawn",
      command: command,
      project: project,
      cols: term.cols,
      rows: term.rows
    }));
  } else {
    showToast("Socket not connected", "error");
  }
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': sessionToken }
    });
    if (!res.ok) throw new Error();
    const projects = await res.json();
    const select = document.getElementById('project-select');
    
    // Preserve "Root" option
    select.innerHTML = '<option value="">Root Environment</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load projects");
  }
}

function promptClone() {
  const url = prompt("Enter Git Repository URL:");
  if (!url) return;
  
  showToast("Cloning repository...");
  fetch('/api/clone', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': sessionToken
    },
    body: JSON.stringify({ repoUrl: url })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      showToast("Clone successful!", "success");
      loadProjects();
    } else {
      showToast(data.error || "Clone failed", "error");
    }
  });
}

function clearTerminal() {
  if (term) term.reset();
}

function closeTerminal() {
  showScreen("launcher-screen");
}

function logout() {
  sessionToken = null;
  sessionStorage.removeItem("pocket_token");
  if (socket) socket.close();
  showScreen("login-screen");
}

// Auto-login on load
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  
  const savedToken = sessionStorage.getItem("pocket_token");
  if (savedToken) {
    sessionToken = savedToken;
    connect(savedToken);
  } else {
    showScreen("login-screen");
  }
});