let ws = null;
let term = null;
let currentTool = "shell";
let reconnecting = false;

// Initialize after DOM load
window.addEventListener("DOMContentLoaded", () => {
  const loginButton = document.getElementById("login-button");
  const passwordInput = document.getElementById("password-input");
  const logoutButton = document.getElementById("logout-button");
  const logoutButtonTerminal = document.getElementById("logout-button-terminal");
  const backButton = document.getElementById("back-to-launcher");

  if (loginButton) {
    loginButton.addEventListener("click", handleLogin);
  }
  if (passwordInput) {
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleLogin();
      }
    });
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }
  if (logoutButtonTerminal) {
    logoutButtonTerminal.addEventListener("click", handleLogout);
  }
  if (backButton) {
    backButton.addEventListener("click", () => {
      switchToLauncher();
    });
  }

  initTerminal();
});

// Do not auto-reload on visibility change; we want to keep sessions while app is backgrounded.
// window.addEventListener("visibilitychange", () => { ... }) // intentionally omitted.

function initTerminal() {
  // Simple xterm-lite: we assume xterm is globally available, or you can plug in your own
  // If you're not using xterm.js, adapt this to your terminal implementation.
  const container = document.getElementById("terminal-container");
  if (!container) return;

  if (window.Terminal) {
    term = new window.Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
      fontSize: 13,
      theme: {
        background: "#000000",
        foreground: "#f4f4f5",
      },
    });
    term.open(container);

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  } else {
    // Fallback: simple contentEditable
    container.textContent =
      "Terminal library not loaded. Please ensure xterm.js is included.";
  }
}

async function handleLogin() {
  const pwdInput = document.getElementById("password-input");
  const errorEl = document.getElementById("login-error");
  if (!pwdInput || !errorEl) return;

  const password = pwdInput.value;
  errorEl.textContent = "";

  try {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data && data.success) {
      // Auth success
      document.getElementById("login-screen").classList.add("hidden");
      document.getElementById("launcher-screen").classList.remove("hidden");
      await loadToolAvailability();
    } else {
      if (data && data.error === "server_misconfigured") {
        errorEl.textContent =
          "Server authentication is not configured. Admin must set TERMINAL_PASSWORD.";
      } else if (data && data.error === "invalid_password") {
        errorEl.textContent = "Invalid password. Access denied.";
      } else if (data && data.error === "invalid_request") {
        errorEl.textContent = "Password is required.";
      } else {
        errorEl.textContent = "Login failed. Please try again.";
      }
    }
  } catch (err) {
    console.error("Login error:", err);
    errorEl.textContent = "Server connection failed.";
  }
}

async function handleLogout() {
  try {
    await fetch("/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout error:", err);
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close();
    } catch (_) {
      // ignore
    }
  }
  document.getElementById("terminal-screen").classList.add("hidden");
  document.getElementById("launcher-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

function switchToLauncher() {
  document.getElementById("terminal-screen").classList.add("hidden");
  document.getElementById("launcher-screen").classList.remove("hidden");
  // Do NOT kill the session automatically here; user may want to resume quickly.
  // We keep WS open; closing is done when user logs out or the server closes it.
}

async function loadToolAvailability() {
  try {
    const res = await fetch("/tools", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    const tools = data.tools || [];

    tools.forEach((tool) => {
      const card = document.querySelector(
        `.cli-card[data-tool-id="${tool.id}"]`
      );
      if (!card) return;

      if (!tool.available) {
        card.classList.add("cli-card-disabled");
        card.setAttribute("aria-disabled", "true");
        if (tool.reason) {
          card.setAttribute("title", tool.reason);
        }
        card.onclick = null;
      } else {
        card.classList.remove("cli-card-disabled");
        card.removeAttribute("aria-disabled");
        if (!card.getAttribute("data-original-title")) {
          card.setAttribute("data-original-title", card.getAttribute("title") || "");
        }
        card.removeAttribute("title");
        // Ensure click handler exists
        const toolId = card.getAttribute("data-tool-id");
        card.onclick = () => launchCLI(toolId);
      }
    });
  } catch (err) {
    console.error("Failed to load tool availability:", err);
  }
}

function setTerminalHeader(toolId, statusText) {
  const toolLabel = document.getElementById("terminal-tool-label");
  const statusEl = document.getElementById("terminal-status");

  if (toolLabel) {
    const pretty =
      toolId === "shell"
        ? "Shell"
        : toolId.charAt(0).toUpperCase() + toolId.slice(1);
    toolLabel.textContent = pretty;
  }
  if (statusEl && statusText != null) {
    statusEl.textContent = statusText;
  }
}

function launchCLI(toolId) {
  currentTool = toolId || "shell";
  setTerminalHeader(currentTool, `Connecting to ${currentTool}…`);

  document.getElementById("launcher-screen").classList.add("hidden");
  document.getElementById("terminal-screen").classList.remove("hidden");

  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close();
    } catch (_) {
      // ignore
    }
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${window.location.host}/terminal?tool=${encodeURIComponent(
    currentTool
  )}`;

  reconnecting = false;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setTerminalHeader(currentTool, `Connected to ${currentTool}`);
  });

  ws.addEventListener("message", (event) => {
    // Try to detect JSON error payloads
    let handled = false;
    if (typeof event.data === "string") {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === "error" && data.message) {
          showToast(data.message, "error");
          setTerminalHeader(currentTool, `Error: ${data.message}`);
          try {
            ws.close();
          } catch (_) {
            // ignore
          }
          handled = true;
        }
      } catch (_) {
        // not JSON, fall through
      }
    }

    if (handled) return;

    if (term && typeof term.write === "function") {
      term.write(event.data);
    }
  });

  ws.addEventListener("close", () => {
    if (!reconnecting) {
      setTerminalHeader(currentTool, `Disconnected from ${currentTool}`);
    }
  });

  ws.addEventListener("error", () => {
    showToast(`Connection error for "${currentTool}"`, "error");
    setTerminalHeader(currentTool, `Error connecting to ${currentTool}`);
  });
}

function showToast(message, type) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = message;
  el.className = "toast";
  if (type === "error") {
    el.classList.add("toast-error");
  } else if (type === "success") {
    el.classList.add("toast-success");
  } else if (type === "warning") {
    el.classList.add("toast-warning");
  }
  el.classList.add("visible");

  clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => {
    el.classList.remove("visible");
  }, 4000);
}