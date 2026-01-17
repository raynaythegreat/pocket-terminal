const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  if (!dirPath) throw new Error("ensureDir requires a path");
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureWorkspaceDirs({ workspaceDir, cliHomeDir }) {
  ensureDir(workspaceDir);
  ensureDir(cliHomeDir);
  ensureDir(path.join(cliHomeDir, "tools"));
}

function toolHomeDir(cliHomeDir, toolId) {
  return path.join(cliHomeDir, "tools", toolId);
}

module.exports = {
  ensureDir,
  ensureWorkspaceDirs,
  toolHomeDir,
};