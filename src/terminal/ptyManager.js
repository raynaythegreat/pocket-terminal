const pty = require("node-pty");
const path = require("path");
const fs = require("fs");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildToolHome({ config, toolId }) {
  const toolHome = path.join(config.cliHomeDir, "tools", toolId);
  ensureDir(toolHome);

  // XDG dirs improve compatibility for CLIs that follow the standard instead of HOME-dotfiles.
  const xdgConfig = path.join(toolHome, ".config");
  const xdgData = path.join(toolHome, ".local", "share");
  const xdgCache = path.join(toolHome, ".cache");

  ensureDir(xdgConfig);
  ensureDir(xdgData);
  ensureDir(xdgCache);

  return { toolHome, xdgConfig, xdgData, xdgCache };
}

function buildSpawnEnv({ config, toolId }) {
  const env = { ...process.env };

  const { toolHome, xdgConfig, xdgData, xdgCache } = buildToolHome({ config, toolId });

  env.HOME = toolHome;
  env.XDG_CONFIG_HOME = xdgConfig;
  env.XDG_DATA_HOME = xdgData;
  env.XDG_CACHE_HOME = xdgCache;

  // Ensure local bins are discoverable
  const repoBin = path.join(config.rootDir, "bin");
  const nodeBin = path.join(config.rootDir, "node_modules", ".bin");

  const extraPathParts = [
    repoBin,
    nodeBin,
    // Common user bin dirs (helpful if a CLI installs itself into HOME)
    path.join(toolHome, ".local", "bin"),
    path.join(toolHome, ".npm-global", "bin"),
    path.join(config.cliHomeDir, ".local", "bin"),
    path.join(config.cliHomeDir, ".npm-global", "bin"),
  ].filter(Boolean);

  const existingPath = env.PATH ? String(env.PATH) : "";
  env.PATH = [...extraPathParts, existingPath].join(path.delimiter);

  return env;
}

function createPty({ config, tool }) {
  const cols = 120;
  const rows = 30;

  const shell = tool.command;
  const args = Array.isArray(tool.args) ? tool.args : [];

  const env = buildSpawnEnv({ config, toolId: tool.id });

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: config.workspaceDir,
    env,
  });

  return ptyProcess;
}

function formatSpawnErrorMessage({ tool, err, config }) {
  const lines = [];
  lines.push("");
  lines.push("Pocket Terminal: failed to start tool");
  lines.push(`Tool: ${tool.name} (${tool.id})`);
  lines.push(`Command: ${tool.command} ${(tool.args || []).join(" ")}`.trim());
  lines.push(`Error: ${err && err.message ? err.message : String(err)}`);
  if (err && err.code) lines.push(`Code: ${err.code}`);
  lines.push(`CWD: ${config.workspaceDir}`);
  lines.push(`PATH: ${process.env.PATH || ""}`);
  lines.push("");
  return lines.join("\r\n");
}

module.exports = {
  createPty,
  buildSpawnEnv,
  formatSpawnErrorMessage,
};