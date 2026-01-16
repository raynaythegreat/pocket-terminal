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

function fileExistsAndIsFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile();
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
  const candidates = [
    path.join(LOCAL_BIN_DIR, bin),
    path.join(NODE_MODULES_BIN_DIR, bin),
  ];

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
 * @param {{bin?: string, packageName?: string, preferRepoScript?: string}} spec
 * @returns {{command: string, args: string[], resolution: string, available: boolean, hint?: string}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;
  const preferRepoScript = spec.preferRepoScript;

  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p)) {
      return { command: p, args: [], resolution: `script:${preferRepoScript}`, available: true };
    }
    if (fileExistsAndIsFile(p)) {
      // Try via node for non-executable JS scripts
      return {
        command: process.execPath,
        args: [p],
        resolution: `node-script:${preferRepoScript}`,
        available: true,
      };
    }
  }

  if (bin) {
    const local = resolveLocalBin(bin);
    if (local) return { command: local, args: [], resolution: `localbin:${bin}`, available: true };

    // Use plain command name; it might exist in PATH (system install)
    return {
      command: bin,
      args: [],
      resolution: `path:${bin}`,
      available: false, // unknown; updated by availability check
    };
  }

  if (packageName) {
    // npx fallback; always "available" in the sense it will attempt to run (may download)
    return {
      command: "npx",
      args: ["-y", packageName],
      resolution: `npx:${packageName}`,
      available: true,
      hint: `Will run via npx: npx -y ${packageName}`,
    };
  }

  return { command: "bash", args: [], resolution: "fallback:bash", available: true };
}

function whichLikeSync(cmd, envPath) {
  // Basic PATH scan; avoids adding deps
  const p = envPath || process.env.PATH || "";
  const dirs = p.split(path.delimiter).filter(Boolean);

  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
          .map((e) => e.toLowerCase())
      : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = process.platform === "win32" ? path.join(dir, cmd + ext) : path.join(dir, cmd);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function shellDefault() {
  if (process.platform === "win32") return { command: "powershell.exe", args: [] };
  return { command: "bash", args: ["-l"] };
}

/**
 * Tool registry: single source of truth
 * - commandSpec is resolved on demand using resolveCommand
 * - installHint is shown in UI when not available
 */
const TOOL_DEFS = [
  {
    id: "shell",
    name: "Shell",
    desc: "Standard interactive shell",
    category: "Core",
    icon: "🐚",
    commandSpec: { bin: process.platform === "win32" ? "powershell.exe" : "bash" },
    installHint: process.platform === "win32" ? "PowerShell should be available by default." : "bash should be available by default.",
  },
  {
    id: "gh",
    name: "GitHub CLI",
    desc: "Manage repos & PRs",
    category: "Dev",
    icon: "🐙",
    commandSpec: { bin: "gh" },
    installHint:
      "Install gh: https://cli.github.com/ (or apt-get install gh). On Render, use a custom build command or Docker image that includes gh.",
  },
  {
    id: "opencode",
    name: "openCode",
    desc: "AI coding CLI launcher",
    category: "AI",
    icon: "🧠",
    commandSpec: { preferRepoScript: "./opencode", bin: "opencode", packageName: "@openai/codex" },
    installHint:
      "Run ./build.sh to install optional tools into ./bin, or install globally. You can also rely on npx for supported packages.",
  },
  {
    id: "copilot",
    name: "Copilot",
    desc: "GitHub Copilot CLI",
    category: "AI",
    icon: "🤖",
    commandSpec: { bin: "copilot", packageName: "@github/copilot" },
    installHint:
      "Install Copilot CLI (optionalDependency) and ensure node_modules are installed. If not available, run: npm i @github/copilot",
  },
  {
    id: "gemini",
    name: "Gemini",
    desc: "Google Gemini CLI",
    category: "AI",
    icon: "✨",
    commandSpec: { bin: "gemini", packageName: "@google/gemini-cli" },
    installHint:
      "Install Gemini CLI (optionalDependency). If not available, run: npm i @google/gemini-cli",
  },
  {
    id: "claude",
    name: "Claude Code",
    desc: "Anthropic Claude Code CLI",
    category: "AI",
    icon: "🧵",
    commandSpec: { bin: "claude", packageName: "@anthropic-ai/claude-code" },
    installHint:
      "Install Claude Code CLI (optionalDependency). If not available, run: npm i @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    name: "Codex",
    desc: "OpenAI Codex CLI",
    category: "AI",
    icon: "🧩",
    commandSpec: { bin: "codex", packageName: "@openai/codex" },
    installHint:
      "Install Codex CLI (optionalDependency). If not available, run: npm i @openai/codex",
  },
  {
    id: "grok",
    name: "Grok",
    desc: "Grok CLI",
    category: "AI",
    icon: "⚡",
    commandSpec: { bin: "grok", packageName: "@vibe-kit/grok-cli" },
    installHint:
      "Install Grok CLI (optionalDependency). If not available, run: npm i @vibe-kit/grok-cli",
  },
  {
    id: "kimi",
    name: "Kimi",
    desc: "Kimi CLI launcher (repo script)",
    category: "AI",
    icon: "🌙",
    commandSpec: { preferRepoScript: "./kimi", bin: "kimi" },
    installHint:
      "Run ./build.sh to install Kimi deps into ./kimi-cli-deps (requires Python). Ensure the ./kimi script is executable.",
  },
];

/**
 * Compute availability:
 * - If resolved to local script or local bin: available true
 * - If resolved to plain command name: check PATH
 * - If resolved to npx: considered available (will attempt install/run)
 */
function getToolStatus(tool) {
  const resolved = resolveCommand(tool.commandSpec || {});
  const envPath = buildPathEnv();

  let available = resolved.available;
  let detectedPath = null;

  if (resolved.resolution.startsWith("path:")) {
    detectedPath = whichLikeSync(resolved.command, envPath);
    available = Boolean(detectedPath);
  } else if (resolved.resolution.startsWith("localbin:") || resolved.resolution.startsWith("script:") || resolved.resolution.startsWith("node-script:")) {
    available = true;
  } else if (resolved.resolution.startsWith("npx:")) {
    available = true;
  }

  return {
    id: tool.id,
    name: tool.name,
    desc: tool.desc,
    category: tool.category,
    icon: tool.icon,
    available,
    resolution: resolved.resolution,
    commandPreview: [resolved.command].concat(resolved.args || []).join(" "),
    detectedPath,
    installHint: tool.installHint || resolved.hint || null,
  };
}

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/api/tools", (_req, res) => {
  const tools = TOOL_DEFS.map(getToolStatus);
  res.json({
    ok: true,
    tools,
    env: {
      platform: process.platform,
      node: process.version,
      workspaceDir: WORKSPACE_DIR,
      cliHomeDir: CLI_HOME_DIR,
    },
  });
});

// Minimal session "intent" endpoint (client can call this before WS to show errors early)
app.post("/api/session", (req, res) => {
  const toolId = String(req.body?.toolId || "").trim();
  const tool = TOOL_DEFS.find((t) => t.id === toolId);
  if (!tool) {
    return res.status(400).json({ ok: false, error: `Unknown toolId: ${toolId}` });
  }
  const status = getToolStatus(tool);
  return res.json({ ok: true, tool: status });
});

const sessions = new Map();
/**
 * @typedef {{
 *  id: string,
 *  pty: import("node-pty").IPty,
 *  ws: import("ws").WebSocket,
 *  toolId: string,
 *  createdAt: number
 * }} Session
 */

function safeJsonSend(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function buildSpawnEnv() {
  const env = { ...process.env };

  env.PATH = buildPathEnv();

  // Prefer a writable HOME for tools that need it
  env.HOME = CLI_HOME_DIR;
  env.USERPROFILE = CLI_HOME_DIR;

  // Some CLIs use XDG
  env.XDG_CONFIG_HOME = path.join(CLI_HOME_DIR, ".config");
  env.XDG_CACHE_HOME = path.join(CLI_HOME_DIR, ".cache");
  env.XDG_DATA_HOME = path.join(CLI_HOME_DIR, ".local", "share");

  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";

  // Prevent some CLIs from trying to open browsers in headless envs
  if (!env.BROWSER) env.BROWSER = "false";

  return env;
}

function normalizeToolId(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v || "shell";
}

function resolveToolCommand(toolId) {
  const tool = TOOL_DEFS.find((t) => t.id === toolId);
  if (!tool) return null;

  if (toolId === "shell") {
    const d = shellDefault();
    return { tool, resolved: { command: d.command, args: d.args, resolution: "default-shell", available: true } };
  }

  const resolved = resolveCommand(tool.commandSpec || {});
  const envPath = buildPathEnv();
  let available = resolved.available;
  let detectedPath = null;

  if (resolved.resolution.startsWith("path:")) {
    detectedPath = whichLikeSync(resolved.command, envPath);
    available = Boolean(detectedPath);
  }

  return { tool, resolved: { ...resolved, available, detectedPath } };
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const toolId = normalizeToolId(url.searchParams.get("tool"));
  const meta = resolveToolCommand(toolId);

  if (!meta) {
    safeJsonSend(ws, { type: "error", message: `Unknown tool: ${toolId}` });
    ws.close();
    return;
  }

  const { tool, resolved } = meta;

  if (!resolved.available && !resolved.resolution.startsWith("npx:")) {
    safeJsonSend(ws, {
      type: "error",
      message: `Tool not installed: ${tool.name}.`,
      installHint: tool.installHint || null,
      resolution: resolved.resolution,
      commandPreview: [resolved.command].concat(resolved.args || []).join(" "),
    });
    ws.close();
    return;
  }

  const cols = Number(url.searchParams.get("cols") || 80);
  const rows = Number(url.searchParams.get("rows") || 24);

  const env = buildSpawnEnv();
  const cwd = WORKSPACE_DIR;

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(resolved.command, resolved.args || [], {
      name: "xterm-256color",
      cols: Number.isFinite(cols) ? cols : 80,
      rows: Number.isFinite(rows) ? rows : 24,
      cwd,
      env,
    });
  } catch (e) {
    safeJsonSend(ws, { type: "error", message: `Failed to spawn: ${e?.message || String(e)}` });
    ws.close();
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  /** @type {Session} */
  const session = { id, pty: ptyProcess, ws, toolId, createdAt: Date.now() };
  sessions.set(id, session);

  safeJsonSend(ws, {
    type: "ready",
    sessionId: id,
    tool: {
      id: tool.id,
      name: tool.name,
      resolution: resolved.resolution,
      commandPreview: [resolved.command].concat(resolved.args || []).join(" "),
    },
    cwd,
    home: CLI_HOME_DIR,
    hostname: os.hostname(),
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    safeJsonSend(ws, { type: "exit", exitCode, signal });
    try {
      ws.close();
    } catch {
      // ignore
    }
    sessions.delete(id);
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      // treat as raw input
      ptyProcess.write(String(raw));
      return;
    }

    if (!msg || typeof msg !== "object") return;

    if (msg.type === "input" && typeof msg.data === "string") {
      ptyProcess.write(msg.data);
      return;
    }

    if (msg.type === "resize") {
      const c = Number(msg.cols);
      const r = Number(msg.rows);
      if (Number.isFinite(c) && Number.isFinite(r) && c > 0 && r > 0) {
        try {
          ptyProcess.resize(c, r);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (msg.type === "signal") {
      const sig = String(msg.signal || "SIGINT");
      try {
        ptyProcess.kill(sig);
      } catch {
        // ignore
      }
      return;
    }
  });

  ws.on("close", () => {
    sessions.delete(id);
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  });

  ws.on("error", () => {
    sessions.delete(id);
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pocket Terminal listening on :${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`WORKSPACE_DIR=${WORKSPACE_DIR}`);
  // eslint-disable-next-line no-console
  console.log(`CLI_HOME_DIR=${CLI_HOME_DIR}`);
});