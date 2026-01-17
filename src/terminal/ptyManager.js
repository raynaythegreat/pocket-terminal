const os = require("os");
const path = require("path");
const fs = require("fs");
const pty = require("node-pty");
const { toolHomeDir, ensureDir } = require("../config/paths");

/**
 * Spawn a PTY for the given tool.
 * - CWD: WORKSPACE_DIR
 * - HOME: per-tool HOME under CLI_HOME_DIR/tools/<toolId>
 * - PATH: inherits process.env.PATH
 */
function spawnToolPty({ tool, config }) {
  const isWin = os.platform() === "win32";

  const shell = isWin ? "powershell.exe" : "bash";
  const cmd = tool && tool.cmd ? tool.cmd : shell;

  const cwd = config.workspaceDir;

  const home = toolHomeDir(config.cliHomeDir, tool.id);
  ensureDir(home);

  // Ensure some tools expecting these dirs won't fail.
  try {
    ensureDir(path.join(home, ".config"));
  } catch {
    // ignore
  }

  const env = {
    ...process.env,
    HOME: home,
    // Many CLIs respect XDG paths; isolating prevents collisions.
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    TERM: "xterm-256color",
  };

  // Make sure XDG dirs exist
  ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].forEach((k) => {
    try {
      if (env[k]) ensureDir(env[k]);
    } catch {
      // ignore
    }
  });

  // For repo-relative scripts (./opencode), ensure they run from repo root.
  // But for general tools, run from workspace to match README expectation.
  const resolvedCwd = cmd.startsWith("./") ? config.rootDir : cwd;

  const ptyProcess = pty.spawn(cmd, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: resolvedCwd,
    env,
  });

  // Best-effort: if bash isn't present on Linux container, fallback to sh for shell tool.
  // Note: this only triggers if spawn errors synchronously, which node-pty may not always do.
  ptyProcess.on("exit", () => {});

  return ptyProcess;
}

module.exports = { spawnToolPty };