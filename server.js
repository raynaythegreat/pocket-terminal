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

function isFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function readFirstBytes(p, maxBytes = 256) {
  try {
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.allocUnsafe(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, Math.max(0, n)).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function isProbablyShellScript(p) {
  if (!isFile(p)) return false;
  const head = readFirstBytes(p, 200);
  if (!head) return false;
  if (head.startsWith("#!")) {
    return head.includes("sh") || head.includes("bash") || head.includes("zsh");
  }
  // if it contains common shell tokens near the top
  return /(^|\n)\s*(export |set -e|#!/bin\/|echo |cd |exec )/i.test(head);
}

function isProbablyNodeScript(p) {
  if (!isFile(p)) return false;
  const head = readFirstBytes(p, 200);
  if (!head) return false;
  if (head.startsWith("#!")) return head.includes("node");
  return /(^|\n)\s*(const |let |var |import |require\(|module\.exports)/.test(head);
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
 * Supports non-executable repo scripts by choosing a runner (bash/node) when possible.
 *
 * @param {{bin?: string, packageName?: string, preferRepoScript?: string, args?: string[]}} spec
 * @returns {{command: string, args: string[], resolution: string, available: boolean, hint?: string}}
 */
function resolveCommand(spec) {
  const bin = spec.bin;
  const packageName = spec.packageName;
  const preferRepoScript = spec.preferRepoScript;
  const args = spec.args || [];

  if (preferRepoScript) {
    const p = path.resolve(__dirname, preferRepoScript);
    if (isExecutableFile(p)) {
      return { command: p, args, resolution: "repo-script", available: true };
    }

    // If it exists but isn't executable, attempt a safe runner fallback.
    if (isFile(p)) {
      if (isProbablyShellScript(p)) {
        const shell = process.platform === "win32" ? null : (process.env.SHELL || "/bin/bash");
        if (shell && isExecutableFile(shell)) {
          return { command: shell, args: [p, ...args], resolution: "repo-script-shell", available: true };
        }
        // try bash explicitly
        return { command: "bash", args: [p, ...args], resolution: "repo-script-bash", available: true };
      }
      if (isProbablyNodeScript(p)) {
        return { command: process.execPath, args: [p, ...args], resolution: "repo-script-node", available: true };
      }

      // last resort: try executing directly (may still work on windows)
      return { command: p, args, resolution: "repo-script-nonexec", available: true };
    }
  }

  if (bin) {
    const local = resolveLocalBin(bin);
    if (local) {
      return { command: local, args, resolution: "local-bin", available: true };
    }

    // Might exist in PATH (system install)
    return {
      command: bin,
      args,
      resolution: "path",
      available: true,
      hint: packageName
        ? `If '${bin}' is not installed, install it or run via npx: npx -y ${packageName}`
        : `If '${bin}' is not installed, install it in your environment.`,
    };
  }

  if (packageName) {
    // Pure npx tool
    return {
      command: "npx",
      args: ["-y", packageName, ...args],
      resolution: "npx",
      available: true,
      hint: `Runs via npx: npx -y ${packageName}`,
    };
  }

  return {
    command: "sh",
    args: ["-lc", "echo 'Tool not configured'"],
    resolution: "none",
    available: false,
    hint: "Tool not configured",
  };
}

function toolHome(toolId) {
  return path.join(CLI_HOME_DIR, "tools", toolId);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeEnvForTool(toolId) {
  const home = toolHome(toolId);
  ensureDir(home);

  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home, // windows-friendly
    PATH: buildPathEnv(),
    // Keep terminal-friendly defaults
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
  };
}

function buildTools() {
  // NOTE: Keep IDs stable (they’re used for per-tool HOME + UI state).
  return [
    {
      id: "shell",
      name: "Shell",
      group: "core",
      description: "System shell in the workspace directory",
      spec: {
        // Spawn via a login-ish shell to pick up PATH/etc; pty uses shell below.
        bin: process.platform === "win32" ? "cmd.exe" : "bash",
        args: process.platform === "win32" ? [] : ["-l"],
      },
      badge: "Ready",
      badgeClass: "badge-ok",
    },
    {
      id: "opencode",
      name: "openCode",
      group: "ai",
      description: "openCode CLI (repo script preferred)",
      spec: {
        preferRepoScript: "./opencode",
        // If repo script is missing, allow local bin or PATH; if neither, npx fallback
        bin: "opencode",
        packageName: "@openai/codex",
      },
    },
    {
      id: "gemini",
      name: "Gemini",
      group: "ai",
      description: "Google Gemini CLI",
      spec: {
        bin: "gemini",
        packageName: "@google/gemini-cli",
      },
    },
    {
      id: "grok",
      name: "Grok",
      group: "ai",
      description: "Grok CLI",
      spec: {
        bin: "grok",
        packageName: "@vibe-kit/grok-cli",
      },
    },
    {
      id: "copilot",
      name: "Copilot",
      group: "ai",
      description: "GitHub Copilot CLI",
      spec: {
        bin: "copilot",
        packageName: "@github/copilot",
      },
    },
    {
      id: "kilocode",
      name: "KiloCode",
      group: "ai",
      description: "KiloCode CLI",
      spec: {
        bin: "kilocode",
        packageName: "@kilocode/cli",
      },
    },
  ];
}

function toolMetaForClient(tool) {
  const resolved = resolveCommand(tool.spec);
  const available = Boolean(resolved.available);

  // “Ready” only when it’s local or repo-script; PATH/npx are still launchable but may require install/auth.
  const ready =
    resolved.resolution === "repo-script" ||
    resolved.resolution === "repo-script-shell" ||
    resolved.resolution === "repo-script-bash" ||
    resolved.resolution === "repo-script-node" ||
    resolved.resolution === "local-bin";

  let badge = "Available";
  let badgeClass = "badge-muted";
  let hint = resolved.hint || null;

  if (ready) {
    badge = "Ready";
    badgeClass = "badge-ok";
    hint = null;
  } else if (available) {
    // PATH or npx
    badge = resolved.resolution === "npx" ? "npx" : "PATH";
    badgeClass = "badge-warn";
  } else {
    badge = "Missing";
    badgeClass = "badge-warn";
  }

  return {
    id: tool.id,
    name: tool.name,
    group: tool.group,
    description: tool.description,
    available,
    badge,
    badgeClass,
    hint,
  };
}

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/tools", (req, res) => {
  const tools = buildTools();
  const payload = tools.map(toolMetaForClient);
  res.json({ tools: payload });
});

// ---- WebSocket terminal sessions ----

/**
 * Detect likely auth prompts (URLs, device codes).
 * (Existing UI expects auth events; keep compatibility.)
 */
function detectAuthHints(text) {
  const hints = [];

  const urlRegex = /\bhttps?:\/\/[^\s)]+/g;
  const urls = text.match(urlRegex) || [];
  for (const url of urls) {
    // Common OAuth device URLs / login URLs
    if (/device|login|oauth|github|microsoft|google/i.test(url)) {
      hints.push({ type: "url", value: url });
    }
  }

  // Common device code patterns
  // Examples: "Enter code: ABCD-EFGH", "User code: XXXX-YYYY"
  const codeRegex = /\b(?:code|user code|device code)\s*[:=]\s*([A-Z0-9-]{4,})\b/i;
  const m = text.match(codeRegex);
  if (m && m[1]) {
    hints.push({ type: "code", value: m[1] });
  }

  return hints;
}

function getShellForPlatform() {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: [] };
  }
  // Prefer bash if available; fall back to sh.
  return { command: "bash", args: ["-l"] };
}

function spawnToolPty(toolId, toolSpec) {
  const resolved = resolveCommand(toolSpec);
  const env = safeEnvForTool(toolId);

  // Default cwd to WORKSPACE_DIR (so repos/projects are in one place).
  const cwd = WORKSPACE_DIR;

  let command = resolved.command;
  let args = resolved.args || [];

  // If we intend npx fallback but npx isn't present, still try running via PATH
  // (node installs should include npx, but some minimal environments might not).
  // We'll just let it fail and report properly.
  const ptyProcess = pty.spawn(command, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env,
  });

  return { ptyProcess, resolved, cwd };
}

wss.on("connection", (socket) => {
  let ptyProcess = null;
  let toolId = "shell";
  let resolvedInfo = null;

  function sendJson(obj) {
    try {
      socket.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  function startTool(newToolId) {
    const tools = buildTools();
    const tool = tools.find((t) => t.id === newToolId) || tools.find((t) => t.id === "shell");
    toolId = tool.id;

    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
      ptyProcess = null;
    }

    try {
      const spec = tool.spec;
      const spawned = spawnToolPty(toolId, spec);
      ptyProcess = spawned.ptyProcess;
      resolvedInfo = spawned.resolved;

      sendJson({
        type: "meta",
        toolId,
        resolution: resolvedInfo?.resolution || "unknown",
        command: resolvedInfo?.command || "",
        args: resolvedInfo?.args || [],
      });

      ptyProcess.onData((data) => {
        sendJson({ type: "data", data });

        // auth hints (best-effort)
        const hints = detectAuthHints(data);
        for (const hint of hints) {
          sendJson({ type: "auth_hint", ...hint });
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        sendJson({
          type: "exit",
          exitCode,
          signal,
          toolId,
          resolution: resolvedInfo?.resolution || "unknown",
          command: resolvedInfo?.command || "",
        });
      });
    } catch (err) {
      const msg = err && typeof err.message === "string" ? err.message : String(err);
      sendJson({
        type: "error",
        message:
          `Failed to start tool '${toolId}'. ` +
          `Resolution=${resolvedInfo?.resolution || "unknown"} ` +
          `Command=${resolvedInfo?.command || ""}\n` +
          msg,
      });
    }
  }

  // Start default shell
  startTool("shell");

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

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
      if (
        ptyProcess &&
        Number.isFinite(msg.cols) &&
        Number.isFinite(msg.rows) &&
        msg.cols > 0 &&
        msg.rows > 0
      ) {
        try {
          ptyProcess.resize(msg.cols, msg.rows);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (msg.type === "start_tool") {
      if (typeof msg.toolId === "string" && msg.toolId.length > 0) {
        startTool(msg.toolId);
      }
      return;
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
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
});

module.exports = server;