/**
 * Environment variable mappings and defaults.
 */
require("dotenv").config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  appPassword: process.env.APP_PASSWORD || "",
  appPasswordHint: process.env.APP_PASSWORD_HINT || "Enter system password",
  workspaceDir: process.env.WORKSPACE_DIR || "./workspace/projects",
  cliHomeDir: process.env.CLI_HOME_DIR || "./workspace/cli-home",
  logLevel: process.env.LOG_LEVEL || "info",
  sessionSecret: process.env.SESSION_SECRET || "pocket-terminal-default-secret",
};