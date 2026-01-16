let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";
let lastTool = "shell";
let termDataDisposable = null;

let pendingFitTimer = null;
let pendingResizeTimer = null;
let authData = { url: null, code: null };

// Set app height for mobile viewport
function setAppHeightVar() {
  const vv = window.visualViewport;
  const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.floor(h)}px`);
}

// Terminal fitting with mobile keyboard support
function scheduleFit() {
  if (!term || !fitAddon) return;

  if (pendingFitTimer) clearTimeout(pendingFitTimer);

  // Two-stage fitting to survive mobile keyboard + layout shifts
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch (e) {
      console.warn("Terminal fit error:", e);
    }

    pendingFitTimer = setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        console.warn("Terminal fit error (delayed):", e);
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 100);
  });
}

// Screen management
function switchToScreen(id) {
  const launcher = document.getElementById("launcher-screen");
  const terminalScreen = document.getElementById("terminal-screen");
  if (!launcher || !terminalScreen) return;

  launcher.classList.toggle("hidden", id !== "launcher-screen");
  terminalScreen.classList.toggle("hidden", id !== "terminal-screen");

  if (id === "terminal-screen") {
    setTimeout(() => scheduleFit(), 50);
  }
}

function switchToLauncher() {
  switchToScreen("launcher-screen");
}

function switchToTerminal() {
  switchToScreen("terminal-screen");
}

// Connection status management
function setConnectionBanner(state, text, showRetry = false) {
  const banner = document.getElementById("connection-status");
  const textEl = document.getElementById("connection-text");
  const retryBtn = document.getElementById("reconnect-btn");

  if (!banner || !textEl || !retryBtn) return;

  connectionStatus = state;
  textEl.textContent = text || "";

  // Update banner styling
  banner.classList.remove("connecting", "connected");
  if (state === "connecting") banner.classList.add("connecting");
  if (state === "connected") banner.classList.add("connected");

  const shouldShow = state !== "connected";
  banner.classList.toggle("hidden", !shouldShow);
  retryBtn.classList.toggle("hidden", !showRetry);
}

// WebSocket management
function disconnectWs() {
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch (e) {
      console.warn("WebSocket close error:", e);
    }
  }
  ws = null;
}

function writeSystemLine(line) {
  if (!term) return;
  term.writeln(`\r\n\x1b[90m${line}\x1b[0m`);
}

function setTerminalHeader(meta) {
  const nameEl = document.getElementById("terminal-tool-name");
  const subEl = document.getElementById("terminal-tool-sub");
  const badgeEl = document.getElementById("terminal-tool-badge");
  if (!nameEl || !subEl || !badgeEl) return;

  nameEl.textContent = meta?.name || "Terminal";
  subEl.textContent = meta?.sub || "";
  badgeEl.textContent = meta?.badge || "…";

  badgeEl.classList.remove("badge-ok", "badge-warn", "badge-muted");
  badgeEl.classList.add(meta?.badgeClass || "badge-muted");
}

// Clipboard utilities
async function copyTextToClipboard(text) {
  const