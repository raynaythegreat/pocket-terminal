let socket;
let term;
let fitAddon;
let authToken = null;
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
    // Small delay to ensure container is rendered before fit
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);
  }
}

function connect(tokenOrPassword) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    reconnectAttempts = 0;
    socket.send(JSON.stringify({ type: "auth", password: tokenOrPassword }));
    document.getElementById('status-dot').className = 'dot online';
    document.getElementById('status-text').textContent = 'CONNECTED';
  };

  socket.onclose = () => {
    document.getElementById('status-dot').className = 'dot offline';
    document.getElementById('status-text').textContent = 'DISCONNECTED';
    scheduleReconnect();
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
          authToken = tokenOrPassword;
          sessionStorage.setItem("pocket_token", authToken);
          showScreen("launcher-screen");
          loadProjects();
          break;
        case "error":
          showToast(data.message, "error");
          if (data.message.toLowerCase().includes("auth")) {
            sessionStorage.removeItem("pocket_token");
            showScreen("login-screen");
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
    const savedToken = sessionStorage.getItem("pocket_token");
    if (savedToken) connect(savedToken);
  }, delay);
}

function initTerminal() {
  if (term) return;
  
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
    theme: terminalTheme,
    allowProposedApi: true,
    rows: 40,
    cols: 80
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  
  term.onData(data => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "data", data }));
    }
  });

  window.addEventListener('resize', () => {
    if (term) fitAddon.fit();
  });
}

function launchCLI(cmd, args = []) {
  const project = document.getElementById('project-select').value;
  document.getElementById('terminal-title').textContent = cmd;
  
  showScreen('terminal-screen');
  initTerminal();
  term.clear();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ 
      type: "spawn", 
      command: cmd, 
      args: args,
      cwd: project 
    }));
  } else {
    showToast("Not connected to server", "error");
  }
}

function closeTerminal() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    // Send Ctrl+C or kill signal if needed, but for now we just switch screen
    // The server handles PTY cleanup when a new spawn happens or socket closes
  }
  showScreen('launcher-screen');
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects", {
      headers: { "Authorization": authToken }
    });
    if (!res.ok) throw new Error("Failed to load environments");
    
    const projects = await res.json();
    const select = document.getElementById("project-select");
    
    // Keep root option
    select.innerHTML = '<option value="">Root Environment</option>';
    
    projects.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function cloneRepo() {
  const url = document.getElementById("repo-url").value.trim();
  if (!url) return showToast("Enter a repository URL", "warning");

  showToast("Cloning repository...", "info");
  
  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": authToken
      },
      body: JSON.stringify({ url })
    });
    
    const data = await res.json();
    if (res.ok) {
      showToast("Cloned successfully!", "success");
      document.getElementById("repo-url").value = "";
      loadProjects();
    } else {
      showToast(data.error || "Clone failed", "error");
    }
  } catch (err) {
    showToast("Network error during clone", "error");
  }
}

function logout() {
  sessionStorage.removeItem("pocket_token");
  if (socket) socket.close();
  location.reload();
}

// Initialization
document.getElementById('login-form').onsubmit = (e) => {
  e.preventDefault();
  const pass = document.getElementById('password').value;
  connect(pass);
};

// Auto-login if token exists
window.addEventListener('load', () => {
  const savedToken = sessionStorage.getItem("pocket_token");
  if (savedToken) {
    connect(savedToken);
  }
});