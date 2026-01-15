let socket;
let term;
let fitAddon;
let authToken = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// Terminal Theme Definition
const terminalTheme = {
  background: '#000000',
  foreground: '#fafafa',
  cursor: '#6366f1',
  selection: 'rgba(99, 102, 241, 0.3)',
  black: '#09090b',
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
    setTimeout(() => fitAddon.fit(), 50);
  }
}

function connect(tokenOrPassword) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    reconnectAttempts = 0;
    socket.send(JSON.stringify({ type: "auth", password: tokenOrPassword }));
    document.getElementById('status-dot').style.background = 'var(--success)';
    document.getElementById('status-text').textContent = 'CONNECTED';
  };

  socket.onclose = () => {
    document.getElementById('status-dot').style.background = 'var(--error)';
    document.getElementById('status-text').textContent = 'DISCONNECTED';
    scheduleReconnect();
  };

  socket.onmessage = (event) => {
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
        if (data.message.includes("auth")) {
          sessionStorage.removeItem("pocket_token");
          showScreen("login-screen");
        }
        break;
      case "data":
        if (term) term.write(data.data);
        break;
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
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: terminalTheme,
    allowProposedApi: true
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById("terminal-container"));
  
  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  window.addEventListener("resize", () => fitAddon.fit());
}

function launchCLI(command, args = []) {
  const project = document.getElementById("project-select").value;
  initTerminal();
  
  // Clear previous terminal content
  term.reset();
  
  socket.send(JSON.stringify({
    type: "start",
    command,
    args,
    cwd: project ? `projects/${project}` : undefined
  }));

  document.getElementById('active-cmd').textContent = command;
  showScreen("terminal-screen");
}

function closeTerminal() {
  // We don't kill the process immediately to allow background tasks, 
  // but we hide the overlay
  showScreen("launcher-screen");
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects", {
      headers: { "Authorization": authToken }
    });
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
  } catch (e) {
    console.error("Failed to load projects", e);
  }
}

async function cloneRepo() {
  const url = document.getElementById("repo-url").value;
  const token = document.getElementById("repo-token").value;
  const btn = document.getElementById("clone-btn");

  if (!url) return showToast("URL is required", "error");

  btn.disabled = true;
  btn.textContent = "Cloning...";

  try {
    const res = await fetch("/api/clone", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": authToken 
      },
      body: JSON.stringify({ url, token })
    });

    if (res.ok) {
      showToast("Repository cloned successfully", "success");
      document.getElementById("repo-url").value = "";
      loadProjects();
    } else {
      const err = await res.json();
      showToast(err.error || "Clone failed", "error");
    }
  } catch (e) {
    showToast("Network error during clone", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Clone Repository";
  }
}

function logout() {
  sessionStorage.removeItem("pocket_token");
  window.location.reload();
}

// Initialization
document.getElementById("login-form").onsubmit = (e) => {
  e.preventDefault();
  const pwd = document.getElementById("password").value;
  connect(pwd);
};

window.onload = () => {
  const savedToken = sessionStorage.getItem("pocket_token");
  if (savedToken) {
    connect(savedToken);
  }
};