require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const express = require("express");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3000;

const CLI_HOME_DIR = path.resolve(
  __dirname,
  process.env.CLI_HOME_DIR || path.join("workspace", "cli-home")
);
const WORKSPACE_DIR = path.resolve(
  __dirname,
  process.env.WORKSPACE_DIR || path.join("workspace", "projects")
);
const LOCAL_BIN_DIR = path.join(__dirname, "bin");
const NODE_MODULES_BIN_DIR = path.join(__dirname, "node_modules", ".bin");

// Ensure directories exist
for (const d of [CLI_HOME_DIR, WORKSPACE_DIR, LOCAL_BIN_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === "win32") return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function firstExistingExecutable(candidates) {
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function resolveLocalBin(bin) {
  const candidates = [path.join(LOCAL_BIN_DIR, bin), path.join(NODE_MODULES_BIN_DIR, bin)];

  if (process.platform === "win32") {
    const exts = [".cmd", ".exe", ".bat"];
    const bases = [path.join(LOCAL_BIN_DIR, bin), path.join(NODE_MODULES_BIN_DIR, bin)];
    for (const base of bases) for (const ext of exts) candidates.push(base + ext);
  }

  return firstExistingExecutable(candidates);
}

function buildPathEnv() {
  const parts = [];
  parts.push(LOCAL_BIN_DIR);
  parts.push(NODE_MODULES_BIN_DIR);
  if (process.env.PATH) parts.push(process.env.PATH);
  return parts.filter(Boolean).join(path.delimiter);
}

/**
 * Resolve a command to spawn.
 * - Prefer repo script if provided (e.g. ./opencode)
 * - Prefer local bin in ./bin or node_modules/.bin
 * - Else use a plain command name (may exist in PATH)
 * - Else fallback to: npx -y <packageName>
 *
 * @param {{bin?: string, packageName?: string, preferRepoScript?: string, args?: string[]}} spec
 * @returns {{command: string, args: string[], resolution: string, available: boolean, hint?: string}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;
  const preferRepoScript = spec.preferRepoScript;

  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p)) {
      return { command: p, args: spec.args || [], resolution: "repo-script", available: true };
    }
  }

  if (bin) {
    const local = resolveLocalBin(bin);
    if (local) {
      return { command: local, args: spec.args || [], resolution: "local-bin", available: true };
    }

    // Try as PATH command (may exist in container)
    return {
      command: bin,
      args: spec.args || [],
      resolution: "path",
      available: true,
      hint: packageName
        ? `If "${bin}" is not found, install "${packageName}" or run via npx.`
        : `If "${bin}" is not found, install it on the server.`,
    };
  }

  if (packageName) {
    return {
      command: "npx",
      args: ["-y", packageName, ...(spec.args || [])],
      resolution: "npx",
      available: true,
      hint: `Running via npx. For faster startup, install "${packageName}" during build.`,
    };
  }

  return {
    command: "bash",
    args: ["-lc", "echo 'No command spec provided'"],
    resolution: "invalid",
    available: false,
    hint: "Tool is misconfigured on the server.",
  };
}

function getToolRegistry() {
  // Keep this list in sync with the optional deps / build.sh scripts
  return [
    {
      id: "shell",
      name: "Shell",
      group: "core",
      description: "Interactive bash shell in the workspace",
      spec: { bin: process.platform === "win32" ? "cmd.exe" : "bash", args: [] },
      badge: "Ready",
      badgeClass: "badge-ok",
      installHint: null,
      spawn: { cwd: WORKSPACE_DIR },
    },
    {
      id: "opencode",
      name: "OpenCode",
      group: "ai",
      description: "Code assistant TUI (repo wrapper or local install)",
      spec: { preferRepoScript: "./opencode", bin: "opencode", packageName: "@openai/codex" },
      installHint: `Run ./build.sh (installs optional tools into ./bin) or install the tool in your image.`,
      // TUI rendering tends to look wrong unless we set a strong TERM and colors.
      spawn: {
        cwd: WORKSPACE_DIR,
        env: {
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          FORCE_COLOR: "1",
        },
      },
    },
    {
      id: "copilot",
      name: "Copilot CLI",
      group: "ai",
      description: "GitHub Copilot CLI",
      spec: { bin: "copilot", packageName: "@github/copilot" },
      installHint: `Install @github/copilot (optionalDependency) or run ./build.sh if you bundle it into ./bin.`,
      spawn: {
        cwd: WORKSPACE_DIR,
        // Prevent server trying to launch a browser; client will open auth URL.
        env: {
          BROWSER: "false",
          NO_BROWSER: "1",
        },
      },
    },
    {
      id: "claude",
      name: "Claude Code",
      group: "ai",
      description: "Anthropic Claude Code CLI",
      spec: { bin: "claude", packageName: "@anthropic-ai/claude-code" },
      installHint: `Set ANTHROPIC_API_KEY in your hosting environment variables (Vercel or Render) or .env.local.`,
      spawn: { cwd: WORKSPACE_DIR },
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      group: "ai",
      description: "Google Gemini CLI",
      spec: { bin: "gemini", packageName: "@google/gemini-cli" },
      installHint: `Set GEMINI_API_KEY in your hosting environment variables (Vercel or Render) or .env.local.`,
      spawn: { cwd: WORKSPACE_DIR },
    },
    {
      id: "codex",
      name: "OpenAI Codex",
      group: "ai",
      description: "OpenAI Codex CLI",
      spec: { bin: "codex", packageName: "@openai/codex" },
      installHint: `Set OPENAI_API_KEY in your hosting environment variables (Vercel or Render) or .env.local.`,
      spawn: { cwd: WORKSPACE_DIR },
    },
    {
      id: "grok",
      name: "Grok CLI",
      group: "ai",
      description: "Grok CLI (if installed)",
      spec: { bin: "grok", packageName: "@vibe-kit/grok-cli" },
      installHint: `Install @vibe-kit/grok-cli (optionalDependency) or bundle into ./bin.`,
      spawn: { cwd: WORKSPACE_DIR },
    },
    {
      id: "kilocode",
      name: "KiloCode",
      group: "ai",
      description: "KiloCode CLI",
      spec: { bin: "kilocode", packageName: "@kilocode/cli" },
      installHint: `Install @kilocode/cli (optionalDependency) or bundle into ./bin.`,
      spawn: { cwd: WORKSPACE_DIR },
    },
  ];
}

function getToolById(id) {
  return getToolRegistry().find((t) => t.id === id) || null;
}

function computeToolAvailability(tool) {
  const resolved = resolveCommand(tool.spec);

  // If resolution is "path", we don't actually know if it exists. We'll mark "Maybe"
  // unless a local bin or repo-script exists.
  const existsLocally = resolved.resolution === "repo-script" || resolved.resolution === "local-bin";

  const available =
    resolved.available &&
    (existsLocally || resolved.resolution === "npx" || resolved.resolution === "path");

  const badge = existsLocally ? "Ready" : resolved.resolution === "npx" ? "npx" : "Ready";
  const badgeClass =
    existsLocally || resolved.resolution === "npx" ? "badge-ok" : "badge-muted";

  return {
    id: tool.id,
    name: tool.name,
    group: tool.group,
    description: tool.description,
    available,
    resolution: resolved.resolution,
    command: resolved.command,
    args: resolved.args,
    badge,
    badgeClass,
    hint: tool.installHint || resolved.hint || null,
  };
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/tools", (_req, res) => {
  const tools = getToolRegistry().map(computeToolAvailability);
  res.json({ tools });
});

/**
 * Auth URL / device code detection:
 * Many CLIs print a URL + code (device flow). We'll detect and send a structured message
 * to the client so it can render a copy/open overlay.
 */
function extractAuthHints(text) {
  if (!text) return null;
  const s = String(text);

  // URLs
  const urlMatch = s.match(/https?:\/\/[^\s)]+/g);
  const urls = urlMatch ? Array.from(new Set(urlMatch)) : [];

  // Common device code patterns
  const codeMatches = [];

  // "Enter code XXXX-XXXX" / "code: XXXX-XXXX" / "Code XXXXXXXX"
  const m1 = s.match(/\bcode\b[^A-Z0-9]*([A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})?)\b/i);
  if (m1 && m1[1]) codeMatches.push(m1[1].toUpperCase());

  // GitHub device flow sometimes prints short code or formatted
  const m2 = s.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
  if (m2 && m2[1]) codeMatches.push(m2[1].toUpperCase());

  const codes = Array.from(new Set(codeMatches)).slice(0, 3);

  // Heuristic: only surface if it looks like auth
  const looksLikeAuth =
    /device|authorize|authenticat|verification|login|sign in|activate/i.test(s) ||
    urls.some((u) => /github\.com\/login|microsoft\.com\/devicelogin|google\.com\/device|oauth|authorize/i.test(u));

  if (!looksLikeAuth) return null;

  const primaryUrl =
    urls.find((u) => /github\.com\/login\/device/i.test(u)) ||
    urls.find((u) => /microsoft\.com\/devicelogin/i.test(u)) ||
    urls.find((u) => /google\.com\/device/i.test(u)) ||
    urls[0] ||
    null;

  const primaryCode = codes[0] || null;

  if (!primaryUrl && !primaryCode) return null;

  return { url: primaryUrl, code: primaryCode };
}

function buildCliEnv(toolId, extraEnv) {
  const xdgConfig = path.join(CLI_HOME_DIR, "config");
  const xdgData = path.join(CLI_HOME_DIR, "data");
  const xdgCache = path.join(CLI_HOME_DIR, "cache");

  for (const d of [xdgConfig, xdgData, xdgCache]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // Per-tool home helps avoid config collisions while still persisting.
  const toolHome = path.join(CLI_HOME_DIR, "tools", toolId);
  if (!fs.existsSync(toolHome)) fs.mkdirSync(toolHome, { recursive: true });

  const env = {
    ...process.env,
    PATH: buildPathEnv(),
    HOME: toolHome,
    USERPROFILE: toolHome, // windows-ish
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    XDG_CACHE_HOME: xdgCache,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
    // Encourage device flow / no browser in headless environments
    BROWSER: process.env.BROWSER || "false",
    NO_BROWSER: process.env.NO_BROWSER || "1",
    ...extraEnv,
  };

  return env;
}

wss.on("connection", (socket) => {
  let ptyProcess = null;
  let toolMeta = null;

  function safeSend(obj) {
    try {
      socket.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  socket.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "start") {
      const toolId = typeof msg.toolId === "string" ? msg.toolId : "shell";
      const tool = getToolById(toolId) || getToolById("shell");
      toolMeta = tool;

      const resolved = resolveCommand(tool.spec);

      // Spawn env + cwd
      const env = buildCliEnv(tool.id, tool.spawn?.env || {});
      const cwd = tool.spawn?.cwd || WORKSPACE_DIR;

      // Give client tool metadata
      safeSend({
        type: "tool",
        tool: {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          resolution: resolved.resolution,
          hint: tool.installHint || resolved.hint || null,
        },
      });

      try {
        ptyProcess = pty.spawn(resolved.command, resolved.args || [], {
          name: "xterm-256color",
          cols: Number(msg.cols) || 80,
          rows: Number(msg.rows) || 24,
          cwd,
          env,
        });
      } catch (err) {
        safeSend({
          type: "system",
          level: "error",
          message: `Failed to start ${tool.name}: ${err?.message || String(err)}`,
        });
        return;
      }

      ptyProcess.onData((data) => {
        // Pass through raw terminal output
        safeSend({ type: "data", data });

        // Also scan for auth hints
        const hint = extractAuthHints(data);
        if (hint) {
          safeSend({
            type: "auth",
            toolId: tool.id,
            toolName: tool.name,
            url: hint.url,
            code: hint.code,
          });
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        safeSend({
          type: "exit",
          exitCode,
          signal,
        });
      });

      return;
    }

    if (msg.type === "input") {
      if (ptyProcess && typeof msg.data === "string") {
        try {
          ptyProcess.write(msg.data);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (msg.type === "resize") {
      if (ptyProcess) {
        const cols = Math.max(2, Number(msg.cols) || 80);
        const rows = Math.max(2, Number(msg.rows) || 24);
        try {
          ptyProcess.resize(cols, rows);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (msg.type === "stop") {
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // ignore
        }
      }
    }
  });

  socket.on("close", () => {
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
      ptyProcess = null;
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pocket Terminal listening on :${PORT}`);
});

module.exports = server;