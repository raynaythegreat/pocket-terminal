let ws = null;
let term = null;
let fitAddon = null;
let currentTool = "shell";
let connectionStatus = "disconnected";
let lastTool = "shell";
let termDataDisposable = null;

function setAppHeightVar() {
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
        // ignore
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

function initTerminal() {
  const container = document.getElementById("terminal-container");
  if (!container || typeof Terminal === "undefined") return;

  term = new Terminal({
    cursorBlink: true,
    fontFamily: "ui-monospace, JetBrains Mono, Menlo, Monaco, monospace",
    fontSize: 14,
    allowProposedApi: true,
    convertEol: true,
    scrollback: 5000,
    // Helps TUIs that rely on background/foreground colors
    theme: {
      background: "#0b0b0f",
    },
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  scheduleFit();

  if (termDataDisposable) {
    try {
      termDataDisposable.dispose();
    } catch {
      // ignore
    }
  }

  termDataDisposable = term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });
}

async function fetchTools() {
  const loading = document.getElementById("tools-loading");
  const errEl = document.getElementById("tools-error");
  const coreEl = document.getElementById("tools-core");
  const aiEl = document.getElementById("tools-ai");
  const devEl = document.getElementById("tools-dev");

  for (const el of [coreEl, aiEl, devEl]) {
    if (el) el.innerHTML = "";
  }

  if (loading) loading.classList.remove("hidden");
  if (errEl) errEl.classList.add("hidden");

  try {
    const resp = await fetch("/api/tools");
    if (!resp.ok) throw new Error(`Failed to load tools (${resp.status})`);
    const data = await resp.json();
    const tools = Array.isArray(data.tools) ? data.tools : [];

    for (const t of tools) {
      const card = renderToolCard(t);
      const group = t.group || "dev";
      const target = group === "core" ? coreEl : group === "ai" ? aiEl : devEl;
      if (target) target.appendChild(card);
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = err?.message || String(err);
      errEl.classList.remove("hidden");
    }
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function renderToolCard(tool) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tool-card";
  btn.setAttribute("aria-label", `Launch ${tool.name}`);

  const top = document.createElement("div");
  top.className = "tool-card-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "tool-title";
  title.textContent = tool.name || tool.id;

  const desc = document.createElement("div");
  desc.className = "tool-desc text-sm text-muted";
  desc.textContent = tool.description || "";

  left.appendChild(title);
  left.appendChild(desc);

  const badge = document.createElement("div");
  badge.className = `badge ${tool.badgeClass || "badge-muted"}`;
  badge.textContent = tool.badge || (tool.available ? "Ready" : "Install");

  top.appendChild(left);
  top.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "tool-actions";

  const launchBtn = document.createElement("button");
  launchBtn.type = "button";
  launchBtn.className = "primary-btn btn-sm";
  launchBtn.textContent = "Launch";
  launchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startTool(tool.id, tool);
  });

  actions.appendChild(launchBtn);

  if (tool.hint) {
    const hintBtn = document.createElement("button");
    hintBtn.type = "button";
    hintBtn.className = "secondary-btn btn-sm";
    hintBtn.textContent = "Install hint";
    hintBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      alert(tool.hint);
    });
    actions.appendChild(hintBtn);
  }

  btn.appendChild(top);
  btn.appendChild(actions);

  btn.addEventListener("click", () => startTool(tool.id, tool));
  return btn;
}

function connectWs() {
  disconnectWs();

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${window.location.host}/ws`;

  setConnectionBanner("connecting", "Connecting…", false);

  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnectionBanner("connected", "Connected", false);
    if (term) {
      ws.send(
        JSON.stringify({
          type: "start",
          toolId: currentTool,
          cols: term.cols,
          rows: term.rows,
        })
      );
    }
  };

  ws.onmessage = (evt) => {
    let msg = null;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "data" && typeof msg.data === "string") {
      if (term) term.write(msg.data);
      return;
    }

    if (msg.type === "system") {
      writeSystemLine(msg.message || "System message");
      return;
    }

    if (msg.type === "tool") {
      const t = msg.tool || {};
      setTerminalHeader({
        name: t.name || "Session",
        sub: t.description || "",
        badge: t.resolution || "ready",
        badgeClass: "badge-ok",
      });
      if (t.hint) writeSystemLine(`Hint: ${t.hint}`);
      return;
    }

    if (msg.type === "auth") {
      showAuthOverlay(msg);
      return;
    }

    if (msg.type === "exit") {
      writeSystemLine(`Process exited (${msg.exitCode ?? "?"}${msg.signal ? `, ${msg.signal}` : ""})`);
      return;
    }
  };

  ws.onerror = () => {
    setConnectionBanner("disconnected", "Connection error", true);
  };

  ws.onclose = () => {
    setConnectionBanner("disconnected", "Disconnected", true);
  };
}

function startTool(toolId, toolMeta) {
  lastTool = currentTool;
  currentTool = toolId;

  setTerminalHeader({
    name: toolMeta?.name || toolId,
    sub: toolMeta?.description || "",
    badge: toolMeta?.badge || "Starting…",
    badgeClass: toolMeta?.badgeClass || "badge-muted",
  });

  hideAuthOverlay();

  switchToScreen("terminal-screen");

  if (!term) initTerminal();
  if (term) term.reset();

  connectWs();
}

function bindUi() {
  const refreshBtn = document.getElementById("refresh-tools");
  if (refreshBtn) refreshBtn.addEventListener("click", () => fetchTools());

  const helpBtn = document.getElementById("open-help");
  if (helpBtn)
    helpBtn.addEventListener("click", () => {
      alert(
        [
          "Tips:",
          "- If a CLI asks to open a browser, use the Auth panel in the terminal view.",
          "- Your logins/config persist under CLI_HOME_DIR.",
          "- Run ./build.sh during build to bundle optional tools into ./bin.",
        ].join("\n")
      );
    });

  const backBtn = document.getElementById("back-to-launcher");
  if (backBtn)
    backBtn.addEventListener("click", () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
      disconnectWs();
      switchToLauncher();
    });

  const copyBtn = document.getElementById("terminal-copy");
  if (copyBtn)
    copyBtn.addEventListener("click", async () => {
      const text = term ? term.getSelection() : "";
      if (!text) return alert("Select text in the terminal to copy.");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        alert("Copy failed (clipboard not available).");
      }
    });

  const clearBtn = document.getElementById("terminal-clear");
  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      if (term) term.clear();
    });

  const retryBtn = document.getElementById("reconnect-btn");
  if (retryBtn) retryBtn.addEventListener("click", () => connectWs());

  // Auth overlay bindings
  const close = document.getElementById("auth-close");
  if (close) close.addEventListener("click", () => hideAuthOverlay());

  const openUrl = document.getElementById("auth-open-url");
  if (openUrl)
    openUrl.addEventListener("click", () => {
      const urlEl = document.getElementById("auth-url");
      const url = urlEl ? urlEl.textContent : "";
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

  const copyUrl = document.getElementById("auth-copy-url");
  if (copyUrl)
    copyUrl.addEventListener("click", async () => {
      const urlEl = document.getElementById("auth-url");
      const url = urlEl ? urlEl.textContent : "";
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        alert("Copy failed.");
      }
    });

  const copyCode = document.getElementById("auth-copy-code");
  if (copyCode)
    copyCode.addEventListener("click", async () => {
      const codeEl = document.getElementById("auth-code");
      const code = codeEl ? codeEl.textContent : "";
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        alert("Copy failed.");
      }
    });

  window.addEventListener("resize", () => scheduleFit());
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => scheduleFit());
  window.addEventListener("orientationchange", () => scheduleFit());
}

function showAuthOverlay(msg) {
  const overlay = document.getElementById("auth-overlay");
  const toolEl = document.getElementById("auth-tool");
  const urlRow = document.getElementById("auth-url-row");
  const codeRow = document.getElementById("auth-code-row");
  const urlEl = document.getElementById("auth-url");
  const codeEl = document.getElementById("auth-code");

  if (!overlay || !toolEl || !urlRow || !codeRow || !urlEl || !codeEl) return;

  toolEl.textContent = msg.toolName ? `Tool: ${msg.toolName}` : "";

  const url = msg.url || "";
  const code = msg.code || "";

  urlEl.textContent = url;
  codeEl.textContent = code;

  urlRow.classList.toggle("hidden", !url);
  codeRow.classList.toggle("hidden", !code);

  overlay.classList.remove("hidden");
}

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function boot() {
  setAppHeightVar();
  window.addEventListener("resize", setAppHeightVar);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", setAppHeightVar);

  bindUi();
  fetchTools();
}

boot();