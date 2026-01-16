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

  window.addEventListener("resize", scheduleFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      setAppHeightVar();
      scheduleFit();
    });
  }
}

function buildWsUrl(tool) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${proto}//${location.host}/ws`;
  const cols = term ? term.cols : 80;
  const rows = term ? term.rows : 24;
  const u = new URL(base);
  u.searchParams.set("tool", tool);
  u.searchParams.set("cols", String(cols));
  u.searchParams.set("rows", String(rows));
  return u.toString();
}

function openDialog(id, title, bodyHtml) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  if (title) {
    const titleEl = dlg.querySelector("h3");
    if (titleEl) titleEl.textContent = title;
  }
  if (bodyHtml && id === "hint-dialog") {
    const body = document.getElementById("hint-body");
    if (body) body.innerHTML = bodyHtml;
    const t = document.getElementById("hint-title");
    if (t && title) t.textContent = title;
  }
  if (typeof dlg.showModal === "function") dlg.showModal();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchTools() {
  const loading = document.getElementById("tools-loading");
  const err = document.getElementById("tools-error");
  if (loading) loading.classList.remove("hidden");
  if (err) {
    err.classList.add("hidden");
    err.textContent = "";
  }

  try {
    const r = await fetch("/api/tools", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok || !data?.ok) throw new Error(data?.error || `Failed to load tools (${r.status})`);

    const env = data.env || {};
    const wsEl = document.getElementById("workspace-dir");
    const homeEl = document.getElementById("cli-home-dir");
    if (wsEl) wsEl.textContent = env.workspaceDir || "—";
    if (homeEl) homeEl.textContent = env.cliHomeDir || "—";

    renderTools(Array.isArray(data.tools) ? data.tools : []);
  } catch (e) {
    if (err) {
      err.textContent = e?.message || String(e);
      err.classList.remove("hidden");
    }
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function renderTools(tools) {
  const core = document.getElementById("tools-core");
  const dev = document.getElementById("tools-dev");
  const ai = document.getElementById("tools-ai");
  if (!core || !dev || !ai) return;

  core.innerHTML = "";
  dev.innerHTML = "";
  ai.innerHTML = "";

  const byCat = (cat) => tools.filter((t) => String(t.category || "").toLowerCase() === cat);

  const buckets = [
    ["core", core],
    ["dev", dev],
    ["ai", ai],
  ];

  for (const [cat, el] of buckets) {
    const items = byCat(cat);
    for (const t of items) {
      el.appendChild(buildToolCard(t));
    }
  }
}

function buildToolCard(tool) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tool-card";
  btn.dataset.toolId = tool.id;

  const icon = document.createElement("div");
  icon.className = "tool-icon";
  icon.textContent = tool.icon || "⌘";

  const info = document.createElement("div");
  info.className = "tool-info";

  const nameRow = document.createElement("div");
  nameRow.className = "tool-name-row";

  const name = document.createElement("div");
  name.className = "tool-name";
  name.textContent = tool.name || tool.id;

  const badge = document.createElement("span");
  badge.className = "badge " + (tool.available ? "badge-ok" : "badge-warn");
  badge.textContent = tool.available ? "Ready" : "Install";

  nameRow.appendChild(name);
  nameRow.appendChild(badge);

  const desc = document.createElement("div");
  desc.className = "tool-desc";
  desc.textContent = tool.desc || "";

  info.appendChild(nameRow);
  info.appendChild(desc);

  btn.appendChild(icon);
  btn.appendChild(info);

  btn.addEventListener("click", () => {
    if (!tool.available) {
      const hint = tool.installHint
        ? `<p>${escapeHtml(tool.installHint)}</p>`
        : `<p>This tool is not installed on the server.</p>`;
      const preview = tool.commandPreview ? `<p class="text-xs text-muted">Command: <code>${escapeHtml(tool.commandPreview)}</code></p>` : "";
      openDialog("hint-dialog", `${tool.name} not available`, hint + preview);
      return;
    }
    startSession(tool.id, tool);
  });

  return btn;
}

async function startSession(toolId, toolMeta) {
  lastTool = toolId;
  currentTool = toolId;

  switchToScreen("terminal-screen");
  setTerminalHeader({
    name: toolMeta?.name || toolId,
    sub: "Connecting…",
    badge: toolMeta?.available ? "Ready" : "…",
    badgeClass: toolMeta?.available ? "badge-ok" : "badge-muted",
  });

  if (!term) initTerminal();

  disconnectWs();
  setConnectionBanner("connecting", "Connecting…", false);

  // Preflight check for better errors
  try {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId }),
    });
    const data = await r.json();
    if (!r.ok || !data?.ok) throw new Error(data?.error || "Session preflight failed");
  } catch (e) {
    setConnectionBanner("error", e?.message || String(e), true);
    writeSystemLine(`Preflight error: ${e?.message || String(e)}`);
    return;
  }

  const url = buildWsUrl(toolId);
  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnectionBanner("connected", "Connected", false);
    setTerminalHeader({
      name: toolMeta?.name || toolId,
      sub: toolMeta?.commandPreview || "Connected",
      badge: "Live",
      badgeClass: "badge-ok",
    });
    scheduleFit();
  };

  ws.onmessage = (evt) => {
    const data = evt.data;

    if (typeof data === "string" && (data.startsWith("{") || data.startsWith("["))) {
      try {
        const msg = JSON.parse(data);
        if (msg && msg.type === "ready") {
          const sub = msg.tool?.commandPreview || msg.cwd || "Ready";
          setTerminalHeader({
            name: msg.tool?.name || toolMeta?.name || toolId,
            sub,
            badge: "Live",
            badgeClass: "badge-ok",
          });
          writeSystemLine(`Session ready: ${msg.tool?.name || toolId}`);
          if (msg.cwd) writeSystemLine(`cwd: ${msg.cwd}`);
          if (msg.home) writeSystemLine(`home: ${msg.home}`);
          return;
        }
        if (msg && msg.type === "error") {
          setConnectionBanner("error", msg.message || "Error", true);
          const hint = msg.installHint ? `\nHint: ${msg.installHint}` : "";
          writeSystemLine(`Error: ${msg.message || "Unknown error"}${hint}`);
          return;
        }
        if (msg && msg.type === "exit") {
          writeSystemLine(`Process exited (code=${msg.exitCode}, signal=${msg.signal || "none"})`);
          setConnectionBanner("disconnected", "Session ended", true);
          return;
        }
      } catch {
        // fallthrough
      }
    }

    // Raw PTY data
    if (term) term.write(data);
  };

  ws.onclose = () => {
    if (connectionStatus === "connected") {
      setConnectionBanner("disconnected", "Disconnected", true);
    }
  };

  ws.onerror = () => {
    setConnectionBanner("error", "Connection error", true);
  };
}

function setupUiHandlers() {
  const backBtn = document.getElementById("back-btn");
  const retryBtn = document.getElementById("reconnect-btn");
  const refreshBtn = document.getElementById("refresh-tools");
  const helpBtn = document.getElementById("open-help");
  const copyBtn = document.getElementById("copy-btn");
  const pasteBtn = document.getElementById("paste-btn");
  const ctrlcBtn = document.getElementById("ctrlc-btn");

  if (backBtn) backBtn.addEventListener("click", switchToLauncher);

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      if (!lastTool) lastTool = "shell";
      startSession(lastTool);
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", fetchTools);
  if (helpBtn) helpBtn.addEventListener("click", () => openDialog("help-dialog"));

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        const sel = term?.getSelection ? term.getSelection() : "";
        if (!sel) {
          writeSystemLine("No selection to copy. (Tip: long-press to select on mobile.)");
          return;
        }
        await navigator.clipboard.writeText(sel);
        writeSystemLine("Copied selection to clipboard.");
      } catch (e) {
        writeSystemLine(`Copy failed: ${e?.message || String(e)}`);
      }
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data: text }));
        }
      } catch (e) {
        writeSystemLine(`Paste failed: ${e?.message || String(e)}`);
      }
    });
  }

  if (ctrlcBtn) {
    ctrlcBtn.addEventListener("click", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: "\x03" }));
      }
    });
  }
}

(function boot() {
  setAppHeightVar();
  setupUiHandlers();
  initTerminal();
  fetchTools();

  // Keep launcher visible by default
  switchToScreen("launcher-screen");

  // Recompute app height on viewport changes (mobile URL bar/keyboard)
  window.addEventListener("resize", setAppHeightVar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setAppHeightVar);
  }
})();