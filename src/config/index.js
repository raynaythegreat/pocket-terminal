/**
 * Centralized configuration management for Pocket Terminal.
 * This is the single source of truth for all configuration values.
 */

const { loadEnvConfig } = require("./env");
const { resolvePaths } = require("./paths");

function createConfig() {
  const envConfig = loadEnvConfig();
  const paths = resolvePaths(envConfig);

  return {
    // Server configuration
    port: envConfig.PORT || 3000,
    nodeEnv: envConfig.NODE_ENV || "development",
    
    // Authentication configuration
    auth: {
      password: envConfig.APP_PASSWORD || "",
      hint: envConfig.APP_PASSWORD_HINT || "Enter system password",
    },
    
    // Path configuration
    rootDir: paths.rootDir,
    workspaceDir: paths.workspaceDir,
    cliHomeDir: paths.cliHomeDir,
    
    // WebSocket configuration
    websocket: {
      heartbeatInterval: 30000, // 30 seconds
    },
    
    // Terminal configuration
    terminal: {
      defaultShell: process.env.SHELL || "/bin/bash",
      ptyTimeout: 10000, // 10 seconds
    },
    
    // Tool configuration
    tools: {
      searchPaths: [
        paths.rootDir,
        paths.binDir,
        paths.nodeModulesBinDir,
      ],
      timeout: 5000, // 5 seconds for tool detection
    },
    
    // Logging configuration
    logging: {
      level: envConfig.LOG_LEVEL || "info",
      format: envConfig.NODE_ENV === "production" ? "json" : "pretty",
    },
  };
}

module.exports = { createConfig };