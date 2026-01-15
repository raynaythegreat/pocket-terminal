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

  if (errorEl) errorEl.textContent = "";

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
      if (!data || !data.error) {
        if (errorEl) errorEl.textContent = "Login failed. Please try again.";
        return;
      }

      if (data.error === "server_misconfigured") {
        if (errorEl) {
          errorEl.textContent =
            "Server authentication is not configured. Admin must set TERMINAL_PASSWORD in the server environment.";
        }
      } else if (data.error === "invalid_password") {
        if (errorEl) {
          errorEl.textContent = "Invalid password. Access denied.";
        }
      } else if (data.error === "invalid_request") {
        if (errorEl) {
          errorEl.textContent = "Password is required.";
        }
      } else {
        if (errorEl) errorEl.textContent = "Login failed. Please try again.";
      }
    }
  } catch (err) {
    console.error("Login error:", err);
    if (errorEl) errorEl.textContent = "Server connection failed.";
  }
}

function logout() {
  manuallyLoggedOut = true;
  clearAuthState();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "logout");
  }
  showScreen("login-screen");
}

// The rest of the file would contain connect(), launchCLI(), etc.
// For brevity, we assume existing logic continues unchanged below.
// Ensure this file in your repo still has all other original functions.