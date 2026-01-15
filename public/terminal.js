let socket;
let term;
let fitAddon;
let sessionToken = null;
let reconnectAttempts = 0;
let manuallyLoggedOut = false;

const MAX_RECONNECT_DELAY = 30000;
const TOKEN_STORAGE_KEY = "pocket_token";

// Optimized Terminal Theme to match UI
const terminalTheme = {
  background: "#09090b",
  foreground: "#fafafa",
  cursor: "#6366f1",
  cursorAccent: "#09090b",
  selection: "rgba(99, 102, 241, 0.3)",
  black: "#18181b",
  red: "#ef4444",
  green: "#10b981",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#8b5cf6",
  cyan: "#06b6d4",
  white: "#fafafa",
  brightBlack: "#71717a",
  brightRed: "#f87171",
  brightGreen: "#34d399",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#a78bfa",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
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
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  const target = document.getElementById(id);
  if (target) target.classList.remove("hidden");

  if (id === "terminal-screen" && term) {
    setTimeout(() => {
      if (fitAddon) fitAddon.fit();
      term.focus();
    }, 100);
  }
}

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

function setStoredToken(token) {
  try {
    if (!token) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch (_) {
    // ignore
  }
}

function clearAuthState() {
  sessionToken = null;
  setStoredToken(null);
}

async function handleLogin(e) {
  if (e) e.preventDefault();
  manuallyLoggedOut = false;

  const passwordInput = document.getElementById("password");
  const password = passwordInput ? passwordInput.value : "";
  const errorEl = document.getElementById("login-error");

  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data && data.success && data.token) {
      sessionToken = data.token;
      setStoredToken(sessionToken);
      if (passwordInput) passwordInput.value = "";
      if (errorEl) errorEl.textContent = "";
      connect(sessionToken);
    } else {
      if (errorEl) errorEl.textContent = "Invalid password. Access denied.";
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = "Server connection failed.";
  }
}

function updateConnectionStatus(isOnline) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (dot) dot.className = `dot ${isOnline ? "online" : "offline"}`;
  if (text) text.textContent = isOnline ? "CONNECTED" : "DISCONNECTED";
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  setTimeout(() => {
    // Only reconnect if we still have a token and user didn't log out
    const token = sessionToken || getStoredToken();
    if (!token || manuallyLoggedOut) return;
    connect(token);
  }, delay);
}

function connect(token) {
  sessionToken = token;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    socket = new WebSocket(wsUrl);
  } catch (e) {
    updateConnectionStatus(false);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
    updateConnectionStatus(true);
    socket.send(JSON.stringify({ type: "auth", token: sessionToken }));
  };

  socket.onclose = () => {
    updateConnectionStatus(false);
    // If we are authenticated (token present) and didn't logout, attempt reconnect
    if ((sessionToken || getStoredToken()) && !manuallyLoggedOut) scheduleReconnect();
  };

  socket.onerror = () => {
    updateConnectionStatus(false);
  };

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (msg.type === "auth_ok") {
      // Authenticated: load launcher by default
      showScreen("launcher-screen");
      loadProjects();
      return;
    }

    if (msg.type === "auth_failed" || msg.type === "auth_required") {
      // Token invalid/expired => clear and go to login
      clearAuthState();
      updateConnectionStatus(false);
      showScreen("login-screen");
      showToast("Session expired. Please log in again.", "warning");
      try {
        socket.close();
      } catch (_) {}
      return;
    }

    if (msg.type === "data" && term) {
      term.write(msg.data);
      return;
    }

    if (msg.type === "exit") {
      showToast("Terminal session ended.", "info");
      showScreen("launcher-screen");
      return;
    }
  };
}

async function autostart() {
  // If a token exists, try to connect without showing login
  const token = getStoredToken();
  if (token) {
    sessionToken = token;
    connect(token);
    return;
  }
  showScreen("login-screen");
}

async function loadProjects() {
  const select = document.getElementById("project-select");
  if (!select) return;

  // Keep the first option ("Root Environment") and clear others
  while (select.options.length > 1) select.remove(1);

  const token = sessionToken || getStoredToken();
  if (!token) return;

  try {
    const res = await fetch("/api/projects", {
      headers: { Authorization: token },
    });

    if (res.status === 401) {
      clearAuthState();
      showScreen("login-screen");
      return;
    }

    const projects = await res.json();
    if (Array.isArray(projects)) {
      projects.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
    }
  } catch (_) {
    // ignore; user can still use root env
  }
}

function ensureTerminal() {
  if (term) return;

  term = new Terminal({
    theme: terminalTheme,
    cursorBlink: true,
    fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
    fontSize: 14,
    lineHeight: 1.2,
    scrollback: 5000,
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const container = document.getElementById("terminal");
  if (!container) return;

  term.open(container);
  setTimeout(() => fitAddon.fit(), 50);

  term.onData((data) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  window.addEventListener("resize", () => {
    if (!fitAddon || !term) return;
    fitAddon.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  });
}

function launchCLI(tool, args = []) {
  // This function is referenced by index.html cards.
  // It starts a terminal session and runs the requested tool command.
  ensureTerminal();

  const projectSelect = document.getElementById("project-select");
  const project = projectSelect && projectSelect.value ? projectSelect.value : "";

  showScreen("terminal-screen");
  setTimeout(() => {
    if (fitAddon) fitAddon.fit();
    term.focus();
  }, 100);

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Disconnected. Reconnecting...", "warning");
    const token = sessionToken || getStoredToken();
    if (token) connect(token);
    return;
  }

  socket.send(JSON.stringify({ type: "start", cols: term.cols || 80, rows: term.rows || 24, project }));

  // Send the command after PTY initializes
  setTimeout(() => {
    const cmd = [tool, ...args].join(" ").trim();
    if (cmd && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data: cmd + "\n" }));
    }
  }, 250);
}

async function logout() {
  manuallyLoggedOut = true;

  const token = sessionToken || getStoredToken();
  clearAuthState();

  // Best-effort revoke server-side
  if (token) {
    try {
      await fetch("/logout", { method: "POST", headers: { Authorization: token } });
    } catch (_) {
      // ignore
    }
  }

  try {
    if (socket) socket.close();
  } catch (_) {
    // ignore
  }

  updateConnectionStatus(false);
  showScreen("login-screen");
}

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  autostart();
});

// Expose functions used by inline HTML onclick handlers
window.launchCLI = launchCLI;
window.logout = logout;