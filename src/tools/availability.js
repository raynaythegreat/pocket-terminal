const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isCommandOnPath(command, env) {
  // Windows is out-of-scope for Render, but allow best-effort behavior.
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(whichCmd, [command], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.status === 0 && String(res.stdout || "").trim().length > 0;
}

/**
 * Build a PATH that can discover:
 * - repo ./bin (populated by ./build.sh)
 * - node_modules/.bin
 * - system PATH
 */
function buildProbeEnv({ config }) {
  const env = { ...process.env };

  const repoBin = path.join(config.rootDir, "bin");
  const nodeBin = path.join(config.rootDir, "node_modules", ".bin");

  const parts = [];
  if (fs.existsSync(repoBin)) parts.push(repoBin);
  if (fs.existsSync(nodeBin)) parts.push(nodeBin);

  // Useful for tools that install into local user bins inside tool HOME.
  // (HOME itself is set during PTY spawn, but these paths can exist globally too.)
  parts.push(path.join(config.cliHomeDir, ".local", "bin"));
  parts.push(path.join(config.cliHomeDir, ".npm-global", "bin"));

  const existing = env.PATH ? String(env.PATH) : "";
  env.PATH = [...parts, existing].filter(Boolean).join(path.delimiter);

  return env;
}

function resolveCommandCandidate(candidate, { config, env }) {
  // Explicit relative path candidate (repo-root relative)
  if (candidate.startsWith("./")) {
    const abs = path.join(config.rootDir, candidate);
    if (fs.existsSync(abs) && isExecutableFile(abs)) return abs;
    return null;
  }

  // Absolute path candidate
  if (path.isAbsolute(candidate)) {
    if (fs.existsSync(candidate) && isExecutableFile(candidate)) return candidate;
    return null;
  }

  // Plain command on PATH
  return isCommandOnPath(candidate, env) ? candidate : null;
}

function isToolAvailable(tool, { config }) {
  const env = buildProbeEnv({ config });

  // Subcommand-based tools: e.g. `gh copilot` should be "ready" if `gh` exists.
  if (tool.baseCommand) {
    return isCommandOnPath(tool.baseCommand, env);
  }

  const candidates = Array.isArray(tool.commandCandidates) && tool.commandCandidates.length > 0
    ? tool.commandCandidates
    : [tool.command];

  for (const c of candidates) {
    const resolved = resolveCommandCandidate(c, { config, env });
    if (resolved) return true;
  }

  return false;
}

module.exports = {
  isToolAvailable,
  buildProbeEnv,
};