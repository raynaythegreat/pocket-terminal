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
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build a string from xterm's buffer.
 * We cap by maxLines and maxChars to avoid freezing the browser on huge scrollback.
 */
function getFullTerminalText({ maxLines = 2000, maxChars = 200000 } = {}) {
  if (!term || !term.buffer) return "";

  const buf = term.buffer;
  const normal = buf.normal;
  const active = buf.active;

  const collectLines = [];
  const pushFrom = (b) => {
    if (!b || typeof b.length !== "number" || typeof b.getLine !== "function") return;
    for (let i = 0; i < b.length; i++) {
      const line = b.getLine(i);
      if (!line) continue;
      collectLines.push(line.translateToString(true));
    }
  };

  // Include scrollback + active viewport
  pushFrom(normal);
  if (active !== normal) pushFrom(active);

  // Trim trailing empty lines
  while (collectLines.length > 0 && !collectLines[collectLines.length - 1].trim()) {
    collectLines.pop();
  }

  let start = Math.max(0, collectLines.length - maxLines);
  const sliced = collectLines.slice(start);

  let out = sliced.join("\n");

  let truncated = false;
  if (collectLines.length > maxLines) truncated = true;

  if (out.length > maxChars) {
    truncated = true;
    out = out.slice(out.length - maxChars);
    // try to start at a line boundary
    const idx = out.indexOf("\n");
    if (idx > 0 && idx < 2000) out = out.slice(idx + 1);
  }

  if (truncated) {
    out = `[truncated] Showing last ~${maxLines} lines / ${maxChars} chars.\n\n` + out;
  }

  return out;
}

function setToast(text, kind = "info") {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = text || "";
  el.classList.remove("toast-ok", "toast-warn", "toast-error");
  if (kind === "ok") el.classList.add("toast-ok");
  if (kind === "warn") el.classList.add("toast-warn");
  if (kind === "error") el.classList.add("toast-error");

  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

function showApiErrorHint(toolId, snippet) {
  const box = document.getElementById("api-error-hint");
  if (!box) return;

  const tool = (toolId || "").toLowerCase();
  let hint = "API error detected.";

  if (tool.includes("grok")) {
    hint =
      "Grok CLI API error. Most Grok CLI builds require an API key (often XAI_API_KEY or GROK_API_KEY) rather than device login. Set it in your hosting environment variables (Vercel or Render) or .env.local, then relaunch Grok.";
  } else if (tool.includes("gemini")) {
    hint =
      "Gemini CLI API error. Ensure GEMINI_API_KEY is set in your hosting environment variables (Vercel or Render) or .env.local, then relaunch Gemini.";
  } else if (tool.includes("opencode")) {
    hint =
      "openCode API error. Ensure the required provider API key(s) are set (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY) in your hosting environment variables (Vercel or Render) or .env.local, then relaunch.";
  }

  box.innerHTML = `
    <div class="alert alert-warn" role="alert">
      <div style="font-weight:750;margin-bottom:6px;">${escapeHtml(hint)}</div>
      ${
        snippet
          ? `<div class="text-xs text-muted" style="white-space:pre-wrap;">${escapeHtml(snippet)}</div>`
          : ""
      }
    </div>
  `;
  box.classList.remove("hidden");
}

function hideApiErrorHint() {
  const box = document.getElementById("api-error-hint");
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeApiAuthError(text) {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("401") ||
    t.includes("403") ||
    t.includes("unauthorized") ||
    t.includes("forbidden") ||
    t.includes("invalid api key") ||
    t.includes("missing api key") ||
    t.includes("api key") && t.includes("invalid") ||
    t.includes("api key") && t.includes("missing") ||
    t.includes("authentication failed") ||
    t.includes("permission denied") && t.includes("api")
  );
}

function extractErrorSnippetFromRecentOutput() {
  // Best-effort: xterm doesn't give us a direct "recent raw stream" easily,
  // so we copy a smaller tail of the buffer as context.
  const full = getFullTerminalText({ maxLines: 80, maxChars: 8000 });
  const lines = full.split("\n");
  return lines.slice(Math.max(0, lines.length - 20)).join("\n").trim();
}

async function handleCopyButton() {
  if (!term) return;

  const selection = term.getSelection ? term.getSelection() : "";
  const text = (selection || "").trim() ? selection : getFullTerminalText();

  const ok = await copyTextToClipboard(text);
  if (ok) setToast(selection ? "Copied selection" : "Copied terminal", "ok");
  else setToast("Copy failed", "error");
}

/* ---------------- Existing app logic below (kept intact) ---------------- */

async function fetchTools() {
  const loading = document.getElementById("tools-loading");
  const errorEl = document.getElementById("tools-error");
  if (loading) loading.classList.remove("hidden");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  try {
    const res = await fetch("/api/tools", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load tools (${res.status})`);
    const data = await res.json();
    renderTools(data);
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err?.message || "Failed to load tools";
      errorEl.classList.remove("hidden");
    }
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function renderTools(data) {
  const groups = {
    core: document.getElementById("tools-core"),
    ai: document.getElementById("tools-ai"),
    dev: document.getElementById("tools-dev"),
    misc: document.getElementById("tools-misc"),
  };

  for (const key of Object.keys(groups)) {
    const el = groups[key];
    if (el) el.innerHTML = "";
  }

  const tools = Array.isArray(data?.tools) ? data.tools : [];
  for (const tool of tools) {
    const groupEl = groups[tool.group] || groups.misc;
    if (!groupEl) continue;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "tool-card";
    card.setAttribute("aria-label", `${tool.name} launcher`);

    const badgeClass = tool.ready ? "badge badge-ok" : tool.npxFallback ? "badge badge-warn" : "badge badge-muted";
    const badgeText = tool.ready ? "Ready" : tool.npxFallback ? "npx" : "Missing";

    card.innerHTML = `
      <div class="tool-card-head">
        <div class="tool-name">${escapeHtml(tool.name)}</div>
        <div class="${badgeClass}">${escapeHtml(badgeText)}</div>
      </div>
      <div class="tool-desc text-sm text-muted">${escapeHtml(tool.description || "")}</div>
      ${
        tool.hint
          ? `<div class="tool-hint text-xs">${escapeHtml(tool.hint)}</div>`
          : ""
      }
    `;

    card.addEventListener("click", () => startTool(tool.id));
    groupEl.appendChild(card);
  }
}

function bindUi() {
  setAppHeightVar();
  const vv = window.visualViewport;
  if (vv) vv.addEventListener("resize", () => setAppHeightVar());
  window.addEventListener("resize", () => setAppHeightVar());

  const refreshBtn = document.getElementById("refresh-tools");
  if (refreshBtn) refreshBtn.addEventListener("click", () => fetchTools());

  const retryBtn = document.getElementById("reconnect-btn");
  if (retryBtn) retryBtn.addEventListener("click", () => connectWs(true));

  const backBtn = document.getElementById("back-to-launcher");
  if (backBtn) backBtn.addEventListener("click", () => switchToLauncher());

  const copyBtn = document.getElementById("copy-terminal");
  if (copyBtn) copyBtn.addEventListener("click", () => handleCopyButton());
}

function ensureXtermLoaded() {
  if (window.Terminal && window.FitAddon) return true;
  return false;
}

function initTerminal() {
  if (term) return;
  if (!ensureXtermLoaded()) {
    writeSystemLine("xterm not loaded");
    return;
  }

  term = new window.Terminal({
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    convertEol: true,
    allowProposedApi: true,
  });

  fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const terminalEl = document.getElementById("terminal");
  if (!terminalEl) return;
  term.open(terminalEl);

  // Keep selection enabled (especially for mobile copy)
  try {
    term.options.disableStdin = false;
  } catch {
    // ignore
  }

  scheduleFit();

  window.addEventListener("resize", () => {
    if (pendingResizeTimer) clearTimeout(pendingResizeTimer);
    pendingResizeTimer = setTimeout(() => scheduleFit(), 120);
  });

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", () => {
      if (pendingResizeTimer) clearTimeout(pendingResizeTimer);
      pendingResizeTimer = setTimeout(() => scheduleFit(), 50);
    });
  }

  termDataDisposable = term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });
}

function connectWs(force = false) {
  if (ws && ws.readyState === WebSocket.OPEN && !force) return;

  disconnectWs();
  hideApiErrorHint();
  setConnectionBanner("connecting", "Connecting…", false);

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setConnectionBanner("connected", "", false);
    if (term && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") {
        if (!term) initTerminal();
        if (term) term.write(msg.data);

        // Detect likely API/auth errors and show a hint panel.
        if (looksLikeApiAuthError(msg.data)) {
          const snippet = extractErrorSnippetFromRecentOutput();
          showApiErrorHint(currentTool, snippet);
        }
      } else if (msg.type === "tool") {
        currentTool = msg.toolId || currentTool;
        lastTool = currentTool || lastTool;
        setTerminalHeader(msg.meta || {});
        hideApiErrorHint();
      } else if (msg.type === "exit") {
        writeSystemLine(`\r\n[process exited: ${msg.code}]`);
      }
    } catch {
      // if not json, treat as raw output
      if (!term) initTerminal();
      if (term) term.write(String(event.data || ""));
      if (looksLikeApiAuthError(String(event.data || ""))) {
        const snippet = extractErrorSnippetFromRecentOutput();
        showApiErrorHint(currentTool, snippet);
      }
    }
  };

  ws.onerror = () => {
    setConnectionBanner("error", "Connection error", true);
  };

  ws.onclose = () => {
    setConnectionBanner("disconnected", "Disconnected", true);
  };
}

async function startTool(toolId) {
  hideApiErrorHint();
  lastTool = toolId || lastTool;
  currentTool = toolId || currentTool;

  switchToScreen("terminal-screen");
  initTerminal();
  connectWs();

  // Wait briefly for ws open
  const start = Date.now();
  while ((!ws || ws.readyState !== WebSocket.OPEN) && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 40));
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    writeSystemLine("Unable to connect to server.");
    return;
  }

  ws.send(JSON.stringify({ type: "start", toolId }));
}

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  fetchTools();
});