let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";
let lastTool = "shell";
let termDataDisposable = null;

let pendingFitTimer = null;
let pendingResizeTimer = null;

function setAppHeightVar() {
  const vv = window.visualViewport;
  const h = vv && typeof vv.height === "number" ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.floor(h)}px`);
}

function scheduleFit() {
  if (!term || !fitAddon) return;

  if (pendingFitTimer) clearTimeout(pendingFitTimer);

  // Do two-stage fitting to survive mobile keyboard + layout shifts
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors
    }

    pendingFitTimer = setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 90);
  });
}

function switchToScreen(id) {
  const launcher = document.getElementById("launcher-screen");
  const terminalScreen = document.getElementById("terminal-screen");
  if (!launcher || !terminalScreen) return;

  launcher.classList.toggle("hidden", id !== "launcher-screen");
  terminalScreen.classList.toggle("hidden", id !== "terminal-screen");

  if (id === "terminal-screen") setTimeout(() => scheduleFit(), 0);
}

function switchToLauncher() {
  switchToScreen("launcher-screen");
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

function setTerminalHeader(meta) {
  const nameEl = document.getElementById("terminal-tool-name");
  const subEl = document.getElementById("terminal-tool-sub");
  const badgeEl = document.getElementById("terminal-tool-badge");
  if (!nameEl || !subEl || !badgeEl) return;

  nameEl.textContent = meta?.name || "Session";
  subEl.textContent = meta?.sub || "";
  badgeEl.textContent = meta?.badge || "…";

  badgeEl.classList.remove("badge-ok", "badge-warn", "badge-muted");
  badgeEl.classList.add(meta?.badgeClass || "badge-muted");
}

async function copyTextToClipboard(text) {
  const t = (text || "").trim();
  if (!t) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function wireCopySelectionButton() {
  const btn = document.getElementById("copy-selection-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!term) return;

    // xterm selection API
    const selected = typeof term.getSelection === "function" ? term.getSelection() : "";
    if (!selected) {
      writeSystemLine("Nothing selected to copy.");
      return;
    }

    const ok = await copyTextToClipboard(selected);
    writeSystemLine(ok ? "Copied selection to clipboard." : "Copy failed (clipboard not available).");
  });
}

function initTerminal() {
  const container = document.getElementById("terminal-container");
  if (!container || typeof Terminal === "undefined") return;

  term = new Terminal({
    cursorBlink: true,
    fontFamily: "ui-monospace, JetBrains Mono, Menlo, Monaco, monospace",
    fontSize: 14,
    allowProposedApi: true,
    scrollback: 6000,
    convertEol: true,
    macOptionIsMeta: true,
  });

  if (typeof FitAddon !== "undefined") {
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }

  term.open(container);

  // Ensure container is selectable (iOS sometimes needs this)
  container.classList.add("terminal-selectable");

  // Improve mobile selection: long-press should not immediately focus and swallow selection
  container.addEventListener(
    "touchstart",
    () => {
      // no-op; leaving touch behavior to xterm selection layer
    },
    { passive: true }
  );

  // Initial fit
  setTimeout(() => scheduleFit(), 0);

  // Resize on viewport changes (keyboard open/close)
  const vv = window.visualViewport;
  const onViewportResize = () => {
    setAppHeightVar();
    if (pendingResizeTimer) clearTimeout(pendingResizeTimer);
    pendingResizeTimer = setTimeout(() => scheduleFit(), 60);
  };

  window.addEventListener("resize", onViewportResize, { passive: true });
  if (vv) vv.addEventListener("resize", onViewportResize, { passive: true });

  wireCopySelectionButton();
}

function connectWs(toolId) {
  disconnectWs();

  currentTool = toolId || "shell";
  lastTool = currentTool;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;

  setConnectionBanner("connecting", "Connecting…", false);

  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnectionBanner("connected", "", false);

    // Start the requested tool session
    ws.send(JSON.stringify({ type: "start", tool: currentTool }));

    // If terminal exists, send initial size
    if (term && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };

  ws.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }

    if (msg.type === "meta") {
      setTerminalHeader(msg.meta);
      return;
    }

    if (msg.type === "data") {
      if (term) term.write(msg.data);
      return;
    }

    if (msg.type === "system") {
      writeSystemLine(msg.message || "");
      return;
    }

    if (msg.type === "auth") {
      // Existing UI should handle this if present
      const panel = document.getElementById("auth-panel");
      const urlEl = document.getElementById("auth-url");
      const codeEl = document.getElementById("auth-code");
      if (panel) panel.classList.remove("hidden");
      if (urlEl && msg.url) urlEl.textContent = msg.url;
      if (codeEl && msg.code) codeEl.textContent = msg.code;
      return;
    }
  };

  ws.onerror = () => {
    setConnectionBanner("error", "Connection error", true);
  };

  ws.onclose = () => {
    setConnectionBanner("disconnected", "Disconnected", true);
  };
}

function bindReconnectButton() {
  const btn = document.getElementById("reconnect-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    writeSystemLine("Reconnecting…");
    connectWs(lastTool || "shell");
  });
}

// Tool rendering (minimal; uses existing DOM IDs in index.html)
async function loadTools() {
  const loading = document.getElementById("tools-loading");
  const err = document.getElementById("tools-error");
  const coreEl = document.getElementById("tools-core");
  const aiEl = document.getElementById("tools-ai");

  if (loading) loading.classList.remove("hidden");
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }

  try {
    const res = await fetch("/api/tools", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const tools = Array.isArray(data?.tools) ? data.tools : [];
    const core = tools.filter((t) => t.group === "core");
    const ai = tools.filter((t) => t.group === "ai");

    const renderGroup = (parent, list) => {
      if (!parent) return;
      parent.innerHTML = "";

      for (const tool of list) {
        const card = document.createElement("div");
        card.className = "tool-card";

        const meta = document.createElement("div");
        meta.className = "tool-meta";

        const nameRow = document.createElement("div");
        nameRow.className = "tool-name-row";

        const name = document.createElement("div");
        name.className = "tool-name";
        name.textContent = tool.name || tool.id;

        const badge = document.createElement("span");
        badge.className = "badge " + (tool.badgeClass || "badge-muted");
        badge.textContent = tool.badge || "…";

        nameRow.appendChild(name);
        nameRow.appendChild(badge);

        const desc = document.createElement("div");
        desc.className = "tool-desc text-sm text-muted";
        desc.textContent = tool.description || "";

        meta.appendChild(nameRow);
        meta.appendChild(desc);

        const actions = document.createElement("div");
        actions.className = "tool-actions";

        const launch = document.createElement("button");
        launch.type = "button";
        launch.className = "primary-btn btn-sm";
        launch.textContent = "Launch";
        launch.addEventListener("click", () => {
          switchToScreen("terminal-screen");
          connectWs(tool.id);
          setTimeout(() => scheduleFit(), 0);
        });

        actions.appendChild(launch);

        card.appendChild(meta);
        card.appendChild(actions);

        parent.appendChild(card);
      }
    };

    renderGroup(coreEl, core);
    renderGroup(aiEl, ai);
  } catch (e) {
    if (err) {
      err.textContent = `Failed to load tools: ${e?.message || e}`;
      err.classList.remove("hidden");
    }
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function bindLauncherButtons() {
  const refreshBtn = document.getElementById("refresh-tools");
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadTools());

  const helpBtn = document.getElementById("open-help");
  if (helpBtn) helpBtn.addEventListener("click", () => alert("Help: Pick a tool to launch a session."));

  const backBtn = document.getElementById("back-to-launcher");
  if (backBtn) backBtn.addEventListener("click", () => switchToLauncher());
}

function boot() {
  setAppHeightVar();
  initTerminal();
  bindReconnectButton();
  bindLauncherButtons();
  loadTools();
}

document.addEventListener("DOMContentLoaded", boot);