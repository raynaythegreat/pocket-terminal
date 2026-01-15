let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let reconnecting = false;
let reconnectAttempt = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000; // Start with 1 second
let connectionStatus = "disconnected";

// Initialize after DOM load
window.addEventListener("DOMContentLoaded", () => {
  const loginButton = document.getElementById("login-button");
  const passwordInput = document.getElementById("password-input");
  const logoutButton = document.getElementById("logout-button");
  const logoutButtonTerminal = document.getElementById("logout-button-terminal");
  const backButton = document.getElementById("back-to-launcher");
  const reconnectBtn = document.getElementById("reconnect-btn");

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
  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", () => {
      attemptReconnect();
    });
  }

  initTerminal();

  // Handle window resize for terminal fitting
  window.addEventListener("resize", () => {
    if (term && fitAddon) {
      setTimeout(() => fitAddon.fit(), 100);
    }
  });

  // Handle visibility change - attempt reconnect when coming back
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && connectionStatus === "disconnected" && getCurrentScreen() === "terminal-screen") {
      setTimeout(() => attemptReconnect(), 1000);
    }
  });
});

function initTerminal() {
  const container = document.getElementById("terminal-container");
  if (!container) return;

  if (typeof Terminal !== "undefined") {
    term = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#000000",
        foreground: "#f4f4f5",
        cursor: "#6366f1",
        cursorAccent: "#000000",
        selection: "#3f3f46",
      },
      allowProposedApi: true,
    });

    // Add fit addon for responsive terminal
    if (typeof FitAddon !== "undefined") {
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
    }

    term.open(container);
    
    // Fit terminal to container
    if (fitAddon) {
      setTimeout(() => fitAddon.fit(), 100);
    }

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  } else {
    container.innerHTML = `
      <div class="terminal-error">
        <h3>Terminal Library Not Available</h3>
        <p>Please check your internet connection and reload the page.</p>
        <button onclick="location.reload()" class="primary-btn">Reload</button>
      </div>
    `;
  }
}

function updateConnectionStatus(status, message = "") {
  connectionStatus = status;
  const banner = document.getElementById("connection-status");
  const text = document.getElementById("connection-text");
  const reconnectBtn = document.getElementById("reconnect-btn");
  const terminalStatus = document.getElementById("terminal-status");

  if (!banner || !text) return;

  switch (status) {
    case "connected":
      banner.classList.add("hidden");
      if (terminalStatus) terminalStatus.textContent = "Connected";
      break;
    case "connecting":
      banner.classList.remove("hidden");
      banner.className = "connection-banner connecting";
      text.textContent = message || "Connecting...";
      reconnectBtn.classList.add("hidden");
      if (terminalStatus) terminalStatus.textContent = "Connecting...";
      break;
    case "disconnected":
      banner.classList.remove("hidden");
      banner.className = "connection-banner disconnected";
      text.textContent = message || "Connection lost";
      reconnectBtn.classList.remove("hidden");
      if (terminalStatus) terminalStatus.textContent = "Disconnected";
      break;
    case "error":
      banner.classList.remove("hidden");
      banner.className = "connection-banner error";
      text.textContent = message || "Connection error";
      reconnectBtn.classList.remove("hidden");
      if (terminalStatus) terminalStatus.textContent = "Error";
      break;
  }
}

async function handleLogin() {
  const pwdInput = document.getElementById("password-input");
  const errorEl = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-button");
  
  if (!pwdInput || !errorEl || !loginBtn) return;

  const password = pwdInput.value.trim();
  if (!password) {
    showError(errorEl, "Please enter a password");
    return;
  }

  errorEl.textContent = "";
  loginBtn.textContent = "Authenticating...";
  loginBtn.disabled = true;

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
      let errorMessage = "Invalid password";
      
      if (data && data.error === "server_misconfigured") {
        errorMessage = "Server authentication is not configured. Admin must set TERMINAL_PASSWORD.";
      } else if (data && data.error === "rate_limited") {
        errorMessage = "Too many attempts. Please try again later.";
      } else if (!res.ok && res.status >= 500) {
        errorMessage = "Server error. Please try again.";
      }
      
      showError(errorEl, errorMessage);
    }
  } catch (error) {
    console.error("Login error:", error);
    showError(errorEl, "Connection failed. Please check your internet connection.");
  } finally {
    loginBtn.textContent = "Unlock Terminal";
    loginBtn.disabled = false;
  }
}

function showError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.style.animation = "none";
  setTimeout(() => {
    errorEl.style.animation = "shake 0.5s ease-in-out";
  }, 10);
}

async function loadToolAvailability() {
  try {
    const res = await fetch("/api/tools");
    if (!res.ok) throw new Error("Failed to load tools");
    
    const tools = await res.json();
    updateToolCards(tools);
  } catch (error) {
    console.error("Failed to load tool availability:", error);
  }
}

function updateToolCards(tools) {
  const cards = document.querySelectorAll(".cli-card");
  cards.forEach((card) => {
    const toolId = card.getAttribute("data-tool-id");
    const tool = tools.find((t) => t.id === toolId);
    
    if (tool && tool.available) {
      card.classList.remove("unavailable");
      card.setAttribute("aria-disabled", "false");
    } else {
      card.classList.add("unavailable");
      card.setAttribute("aria-disabled", "true");
      card.onclick = null;
    }
  });
}

function launchCLI(toolId) {
  const card = document.querySelector(`[data-tool-id="${toolId}"]`);
  if (card && card.classList.contains("unavailable")) {
    return;
  }
  
  currentTool = toolId;
  switchToTerminal(toolId);
  connectWebSocket(toolId);
}

function switchToTerminal(toolId) {
  document.getElementById("launcher-screen").classList.add("hidden");
  document.getElementById("terminal-screen").classList.remove("hidden");
  
  const toolName = document.getElementById("terminal-tool-name");
  if (toolName) {
    const toolNames = {
      shell: "Shell",
      kimi: "Kimi CLI",
      opencode: "Opencode CLI",
      claude: "Claude Code",
      gemini: "Gemini CLI",
      copilot: "GitHub Copilot",
      kilocode: "Kilocode CLI",
      codex: "OpenAI Codex",
      grok: "Grok CLI",
    };
    toolName.textContent = toolNames[toolId] || "Terminal";
  }
  
  // Fit terminal when switching screens
  if (term && fitAddon) {
    setTimeout(() => fitAddon.fit(), 100);
  }
}

function switchToLauncher() {
  if (ws) {
    ws.close();
    ws = null;
  }
  
  document.getElementById("terminal-screen").classList.add("hidden");
  document.getElementById("launcher-screen").classList.remove("hidden");
  updateConnectionStatus("disconnected");
  
  if (term) {
    term.clear();
  }
}

function connectWebSocket(toolId) {
  if (ws) {
    ws.close();
  }
  
  reconnectAttempt = 0;
  updateConnectionStatus("connecting", "Connecting to terminal...");
  
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws?tool=${encodeURIComponent(toolId)}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log("WebSocket connected");
    reconnectAttempt = 0;
    reconnectDelay = 1000;
    updateConnectionStatus("connected");
    
    // Send initial terminal size
    if (term && fitAddon) {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };
  
  ws.onmessage = (event) => {
    if (term && typeof event.data === "string") {
      // Handle both plain text and JSON messages
      try {
        const message = JSON.parse(event.data);
        if (message.type === "data" && message.data) {
          term.write(message.data);
        }
      } catch {
        // Plain text message
        term.write(event.data);
      }
    }
  };
  
  ws.onclose = (event) => {
    console.log("WebSocket closed:", event.code, event.reason);
    updateConnectionStatus("disconnected", "Connection closed");
    
    // Auto-reconnect if not manually closed and still on terminal screen
    if (event.code !== 1000 && getCurrentScreen() === "terminal-screen" && !reconnecting) {
      scheduleReconnect();
    }
  };
  
  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateConnectionStatus("error", "Connection failed");
  };
}

function scheduleReconnect() {
  if (reconnectAttempt >= maxReconnectAttempts) {
    updateConnectionStatus("error", `Failed to reconnect after ${maxReconnectAttempts} attempts`);
    return;
  }
  
  reconnecting = true;
  reconnectAttempt++;
  
  const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempt - 1), 30000);
  updateConnectionStatus("connecting", `Reconnecting in ${Math.ceil(delay / 1000)}s...`);
  
  setTimeout(() => {
    if (getCurrentScreen() === "terminal-screen") {
      connectWebSocket(currentTool);
    }
    reconnecting = false;
  }, delay);
}

function attemptReconnect() {
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return;
  }
  
  reconnectAttempt = 0;
  connectWebSocket(currentTool);
}

function getCurrentScreen() {
  const screens = ["login-screen", "launcher-screen", "terminal-screen"];
  for (const screen of screens) {
    const el = document.getElementById(screen);
    if (el && !el.classList.contains("hidden")) {
      return screen;
    }
  }
  return "login-screen";
}

async function handleLogout() {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch (error) {
    console.error("Logout error:", error);
  }
  
  if (ws) {
    ws.close();
    ws = null;
  }
  
  // Clear terminal
  if (term) {
    term.clear();
  }
  
  // Reset state
  reconnecting = false;
  reconnectAttempt = 0;
  updateConnectionStatus("disconnected");
  
  // Show login screen
  document.getElementById("terminal-screen").classList.add("hidden");
  document.getElementById("launcher-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  
  // Clear password field
  const pwdInput = document.getElementById("password-input");
  if (pwdInput) {
    pwdInput.value = "";
    pwdInput.focus();
  }
}

// Prevent zoom on iOS when focusing inputs
document.addEventListener('touchstart', function() {
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
    // This is iOS 13+
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }
  }
});