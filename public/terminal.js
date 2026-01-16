let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";

window.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-to-launcher");
  const clearButton = document.getElementById("clear-terminal");
  const bypassButton = document.getElementById("bypass-login");

  if (backButton) {
    backButton.addEventListener("click", switchToLauncher);
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => term && term.clear());
  }

  if (bypassButton) {
    bypassButton.addEventListener("click", switchToLauncher);
  }

  initTerminal();

  // Handle window resize
  window.addEventListener("resize", () => {
    if (term && fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
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
  document.getElementById("active-tool-name").textContent = toolId.toUpperCase();
  
  switchToScreen("terminal-screen");
  
  if (ws) ws.close();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws?tool=${toolId}&cols=${term.cols}&rows=${term.rows}`;
  
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
    updateConnectionBanner(true, "Disconnected. Tap to reconnect.");
  };

  ws.onerror = () => {
    updateConnectionBanner(true, "Connection error.");
  };
}

function switchToLauncher() {
  if (ws) {
    ws.close();
    ws = null;
  }
  switchToScreen("launcher-screen");
}

function switchToScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(screenId).classList.remove("hidden");
  
  if (screenId === "terminal-screen" && fitAddon) {
    setTimeout(() => fitAddon.fit(), 50);
  }
}

function updateConnectionBanner(show, text = "") {
  const banner = document.getElementById("connection-status");
  const statusText = document.getElementById("connection-text");
  if (!banner) return;

  if (show) {
    banner.classList.remove("hidden");
    statusText.textContent = text;
  } else {
    banner.classList.add("hidden");
  }
}