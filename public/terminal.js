let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";

function setAppHeightVar() {
  // Use visualViewport height when available (best for mobile keyboard + URL bar)
  const vv = window.visualViewport;
  const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.floor(h)}px`);
}

function scheduleFit() {
  if (!term || !fitAddon) return;

  // Fit after layout settles + after potential safe-area/viewport updates
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors
    }
    // A second fit shortly after helps on iOS after address bar/keyboard transitions
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 80);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-to-launcher");
  const clearButton = document.getElementById("clear-terminal");
  const reconnectBtn = document.getElementById("reconnect-btn");

  if (backButton) backButton.addEventListener("click", switchToLauncher);
  if (clearButton) clearButton.addEventListener("click", () => term && term.clear());

  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", () => {
      if (!currentTool) currentTool = "shell";
      startSession(currentTool);
    });
  }

  setAppHeightVar();
  initTerminal();

  // Ensure we always start on the launcher (no auth/login screen)
  switchToScreen("launcher-screen");

  // Window resize (desktop + mobile rotate)
  window.addEventListener("resize", () => {
    setAppHeightVar();
    scheduleFit();
  });

  // Mobile keyboard / URL bar changes
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      setAppHeightVar();
      scheduleFit();
    });
    window.visualViewport.addEventListener("scroll", () => {
      // Some iOS versions change viewport on scroll; keep height updated
      setAppHeightVar();
    });
  }

  // Fit when fonts are ready (prevents off-by-one sizing that hides last row)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scheduleFit()).catch(() => {});
  }
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
    convertEol: true,
    scrollback: 5000,
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  scheduleFit();

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
  setAppHeightVar();
  scheduleFit();

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
    scheduleFit();
  };

  ws.onmessage = (event) => {
    term.write(event.data);
  };

  ws.onclose = () => {
    connectionStatus = "disconnected";
    // If we are still on the terminal screen, show the banner
    const terminalScreen = document.getElementById("terminal-screen");
    if (terminalScreen && !terminalScreen.classList.contains("hidden")) {
      updateConnectionBanner(true, "Disconnected. Tap Retry to reconnect.");
    }
  };

  ws.onerror = () => {
    connectionStatus = "disconnected";
    updateConnectionBanner(true, "Connection error. Tap Retry to reconnect.");
  };
}

/* UI helpers (existing behavior) */
function switchToLauncher() {
  if (ws) ws.close();
  switchToScreen("launcher-screen");
}

function switchToScreen(screenId) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => s.classList.add("hidden"));

  const target = document.getElementById(screenId);
  if (target) target.classList.remove("hidden");

  // When switching to terminal, update height and fit to avoid off-screen rows.
  if (screenId === "terminal-screen") {
    setAppHeightVar();
    scheduleFit();
  }
}

function updateConnectionBanner(show, text) {
  const banner = document.getElementById("connection-status");
  const textEl = document.getElementById("connection-text");
  const reconnectBtn = document.getElementById("reconnect-btn");

  if (!banner) return;

  if (show) {
    banner.classList.remove("hidden");
    if (textEl && typeof text === "string") textEl.textContent = text;
    if (reconnectBtn) reconnectBtn.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    if (reconnectBtn) reconnectBtn.classList.add("hidden");
  }
}