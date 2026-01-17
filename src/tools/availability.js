const fs = require("fs");
const path = require("path");
const os = require("os");
const childProcess = require("child_process");

/**
 * Check if a command exists on this host.
 * Resolution order matches README:
 * - repo scripts (./...)
 * - ./bin (populated by build.sh)
 * - ./node_modules/.bin
 * - System PATH
 */
function checkCommand(cmd, { rootDir }) {
  try {
    if (!cmd) return false;

    if (cmd.startsWith("./")) {
      return fs.existsSync(path.join(rootDir, cmd));
    }

    // ./bin
    const repoBin = path.join(rootDir, "bin", cmd);
    if (fs.existsSync(repoBin)) return true;

    // node_modules/.bin
    const localBin = path.join(rootDir, "node_modules", ".bin", cmd);
    if (fs.existsSync(localBin)) return true;

    const which = os.platform() === "win32" ? "where" : "which";
    childProcess.execSync(`${which} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

module.exports = { checkCommand };