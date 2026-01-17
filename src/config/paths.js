/**
 * Path configuration and workspace directory management for Pocket Terminal.
 * Ensures required directories exist with proper permissions.
 */

const fs = require("fs");
const path = require("path");

/**
 * Ensures workspace directories exist, creating them if necessary.
 * @param {Object} options - Directory paths configuration
 * @param {string} options.workspaceDir - Root directory for projects
 * @param {string} options.cliHomeDir - Root directory for CLI home directories
 * @throws {Error} If directories cannot be created
 */
function ensureWorkspaceDirs({ workspaceDir, cliHomeDir }) {
  if (!workspaceDir || !cliHomeDir) {
    throw new Error("Missing required directory paths");
  }

  try {
    // Ensure workspace directory exists
    ensureDir(workspaceDir);

    // Ensure CLI home directory exists
    ensureDir(cliHomeDir);

    // Ensure tools subdirectory exists
    const toolsDir = path.join(cliHomeDir, "tools");
    ensureDir(toolsDir);

    // Set restrictive permissions on CLI home (security best practice)
    try {
      fs.chmodSync(cliHomeDir, 0o700);
    } catch (chmodErr) {
      console.warn(`Warning: Could not set permissions on ${cliHomeDir}:`, chmodErr.message);
    }

    return {
      workspaceDir,
      cliHomeDir,
      toolsDir,
      success: true,
    };
  } catch (error) {
    // Enhance error with context
    const enhancedError = new Error(
      `Failed to initialize workspace directories: ${error.message}`
    );
    enhancedError.cause = error;
    enhancedError.code = error.code || "EUNKNOWN";
    throw enhancedError;
  }
}

/**
 * Recursively ensures a directory exists with proper error handling.
 * @param {string} dirPath - Path to ensure
 * @throws {Error} If directory cannot be created
 */
function ensureDir(dirPath) {
  try {
    // Check if path exists
    if (fs.existsSync(dirPath)) {
      // Verify it's a directory
      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path exists but is not a directory: ${dirPath}`);
      }
      return;
    }

    // Create directory with parents
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
  } catch (error) {
    if (error.code === "EACCES") {
      throw new Error(`Permission denied: cannot create directory at ${dirPath}`);
    } else if (error.code === "ENOSPC") {
      throw new Error(`No space left on device: cannot create directory at ${dirPath}`);
    } else if (error.code === "EROFS") {
      throw new Error(`Read-only file system: cannot create directory at ${dirPath}`);
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Gets the per-tool home directory path.
 * @param {string} cliHomeDir - Root CLI home directory
 * @param {string} toolId - Tool identifier
 * @returns {string} Path to tool-specific home directory
 */
function getToolHomeDir(cliHomeDir, toolId) {
  if (!toolId || typeof toolId !== "string") {
    throw new Error("Invalid toolId: must be a non-empty string");
  }
  return path.join(cliHomeDir, "tools", toolId);
}

/**
 * Sets up environment variables for a tool's isolated environment.
 * @param {string} toolHomeDir - Tool's home directory
 * @returns {Object} Environment variables object
 */
function getToolEnv(toolHomeDir) {
  return {
    HOME: toolHomeDir,
    XDG_CONFIG_HOME: path.join(toolHomeDir, ".config"),
    XDG_DATA_HOME: path.join(toolHomeDir, ".local", "share"),
    XDG_CACHE_HOME: path.join(toolHomeDir, ".cache"),
  };
}

module.exports = {
  ensureWorkspaceDirs,
  ensureDir,
  getToolHomeDir,
  getToolEnv,
};