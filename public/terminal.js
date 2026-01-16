let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";
let lastTool = "shell";
let termDataDisposable = null;

function setAppHeightVar() {
  // Use visualViewport height when available (best for mobile keyboard + URL bar)
  const vv = window.visualViewport;
  const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.floor(h)}px`);
}

function scheduleFit() {
  if (!term || !fitAddon) return;

  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors
    }

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

function switchToScreen(id) {
  const launcher = document.getElementById("launcher-screen");
  const terminalScreen = document.getElementById("terminal-screen");
  if (!launcher || !terminalScreen) return;

  launcher.classList.toggle("hidden", id !== "launcher-screen");
  terminalScreen.classList.toggle("hidden", id !== "terminal-screen");

  // Re-fit after screen visibility changes
  if (id === "terminal-screen") {
    setTimeout(() => scheduleFit(), 0);
  }
}

function switchToLauncher() {
  switchToScreen("launcher-screen");
  // Do not automatically kill sessions when going back; user can retry or open new.
}

function setConnectionBanner(state, text, showRetry) {
  const banner = document.getElementById("connection-status");
  const textEl = document.getElementById("connection-text");
  const retryBtn = document.getElementById("reconnect-btn");

  if (!banner || !textEl || !retryBtn) return;

  connectionStatus = state;
  textEl.textContent = text || "";

  const shouldShow = state !== "connected";
  banner.classList.toggle("hidden", !shouldShow);

  retryBtn.classList.toggle("hidden", !showRetry);
}

function disconnectWs() {
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {
      // ignore
    }
  }
  ws = null;
}

function writeSystemLine(line) {
  if (!term) return;
  term.writeln(`\r\n\x1b[90m${line}\x1b[0m`);
}

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

  // Ensure we don't double-bind input handler across reconnects
  if (termDataDisposable) {
    try {
      termDataDisposable.dispose();
    } catch {
      // ignore
    }
    termDataDisposable = null;
  }

  termDataDisposable = term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });
}

function updateTerminalTitle(tool) {
  const title = document.getElementById("terminal-title");
  const subtitle = document.getElementById("terminal-subtitle");
  if (!title || !subtitle) return;

  const map = {
    shell: ["Shell", "Interactive shell"],
    gh: ["GitHub CLI", "Run gh commands (auth may be required)"],
    copilot: ["Copilot", "GitHub Copilot CLI"],
    gemini: ["Gemini", "Google Gemini CLI"],
    claude: ["Claude Code", "Anthropic CLI"],
    codex: ["Codex", "OpenAI Codex CLI"],
    grok: ["Grok", "Grok CLI"],
    cline: ["Cline", "Kilo/Cline CLI"],
    opencode: ["OpenCode", "AI coding agent"],
  };

  const entry = map[tool] || ["Terminal", ""];
  title.textContent = entry[0];
  subtitle.textContent = entry[1];
}

function startSession(tool) {
  if (!tool) tool = "shell";

  // Always start a fresh session
  disconnectWs();

  currentTool = tool;
  lastTool = tool;

  updateTerminalTitle(tool);
  switchToScreen("terminal-screen");

  if (!term) {
    initTerminal();
  } else {
    // Clear banner and fit when reusing existing terminal instance
    scheduleFit();
  }

  // Create WS
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${window.location.host}/ws?tool=${encodeURIComponent(tool)}`;

  setConnectionBanner("connecting", "Connecting...", false);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setConnectionBanner("connected", "", false);
    // Fit and send resize to server
    scheduleFit();
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN && term) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 120);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (!term) return;

      if (msg.type === "output" && typeof msg.data === "string") {
        term.write(msg.data);
      } else if (msg.type === "system" && typeof msg.data === "string") {
        writeSystemLine(msg.data);
      } else if (msg.type === "error" && typeof msg.data === "string") {
        writeSystemLine(`Error: ${msg.data}`);
      }
    } catch {
      // If not JSON, treat as raw output
      if (term && typeof ev.data === "string") term.write(ev.data);
    }
  };

  ws.onerror = () => {
    setConnectionBanner("disconnected", "Connection error.", true);
    writeSystemLine("Connection error. Tap Retry to reconnect.");
  };

  ws.onclose = () => {
    setConnectionBanner("disconnected", "Disconnected.", true);
    writeSystemLine("Disconnected. Tap Retry to reconnect.");
  };
}

window.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-to-launcher");
  const clearButton = document.getElementById("clear-terminal");
  const reconnectBtn = document.getElementById("reconnect-btn");

  if (backButton) backButton.addEventListener("click", switchToLauncher);
  if (clearButton) clearButton.addEventListener("click", () => term && term.clear());

  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", () => {
      const tool = lastTool || currentTool || "shell";
      startSession(tool);
    });
  }

  setAppHeightVar();
  initTerminal();

  // Ensure we always start on the launcher
  switchToScreen("launcher-screen");

  window.addEventListener("resize", () => {
    setAppHeightVar();
    scheduleFit();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      setAppHeightVar();
      scheduleFit();
    });
    window.visualViewport.addEventListener("scroll", () => {
      setAppHeightVar();
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scheduleFit()).catch(() => {});
  }
});

// Expose for inline onclick handlers
window.startSession = startSession;