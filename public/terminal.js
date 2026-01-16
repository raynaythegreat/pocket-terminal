let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";

window.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-to-launcher");
  const clearButton = document.getElementById("clear-terminal");
  const reconnectBtn = document.getElementById("reconnect-btn");

  if (backButton) backButton.addEventListener("click", switchToLauncher);
  if (clearButton)
    clearButton.addEventListener("click", () => term && term.clear());

  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", () => {
      if (!currentTool) currentTool = "shell";
      startSession(currentTool);
    });
  }

  initTerminal();

  // Ensure we always start on the launcher (no auth/login screen)
  switchToScreen("launcher-screen");

  // Handle window resize
  window.addEventListener("resize", () => {
    if (term && fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
          );
        }
      }, 100);
    }
  });
});

function initTerminal() {
  const container = document.getElementById("terminal-container");
  if (!container || typeof Terminal === "undefined") return;

  term = new Terminal({
    cursorBlink: true,
    fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
    fontSize: 14,
    theme: {
      background: "#09090b",
      foreground: "#fafafa",
      cursor: "#6366f1",
    },
    allowProposedApi: true,
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", content: data }));
    }
  });
}

function startSession(toolId) {
  currentTool = toolId;
  const activeToolName = document.getElementById("active-tool-name");
  if (activeToolName) activeToolName.textContent = String(toolId).toUpperCase();

  switchToScreen("terminal-screen");

  if (ws) ws.close();

  // If terminal isn't ready for some reason, fail gracefully.
  if (!term) {
    updateConnectionBanner(true, "Terminal failed to initialize.");
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws?tool=${encodeURIComponent(
    toolId
  )}&cols=${term.cols}&rows=${term.rows}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connectionStatus = "connected";
    term.clear();
    term.focus();
    updateConnectionBanner(false);
  };

  ws.onmessage = (event) => {
    term.write(event.data);
  };

  ws.onclose = () => {
    connectionStatus = "disconnected";
    // If we are still on the terminal screen, show the banner
    const terminalScreen = document.getElementById("terminal-screen");
    if (terminalScreen && !terminalScreen.classList.contains("hidden")) {
      updateConnectionBanner(true, "Disconnected.", true);
    }
  };

  ws.onerror = () => {
    connectionStatus = "disconnected";
    updateConnectionBanner(true, "Connection error.", true);
  };
}

function switchToLauncher() {
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      // ignore
    }
  }
  switchToScreen("launcher-screen");
}

function switchToScreen(screenId) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => s.classList.add("hidden"));

  const target = document.getElementById(screenId);
  if (target) target.classList.remove("hidden");
}

function updateConnectionBanner(show, text, showRetry = false) {
  const banner = document.getElementById("connection-status");
  const textEl = document.getElementById("connection-text");
  const retryBtn = document.getElementById("reconnect-btn");

  if (!banner || !textEl || !retryBtn) return;

  if (show) {
    banner.classList.remove("hidden");
    textEl.textContent = text || "Disconnected.";
    if (showRetry) retryBtn.classList.remove("hidden");
    else retryBtn.classList.add("hidden");
  } else {
    banner.classList.add("hidden");
    retryBtn.classList.add("hidden");
  }
}