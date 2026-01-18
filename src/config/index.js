/**
 * Central configuration object for the application.
 */
const path = require("path");
const env = require("./env");

const rootDir = path.resolve(__dirname, "../../");

const config = {
  rootDir,
  nodeEnv: env.nodeEnv,
  port: env.port,
  workspaceDir: path.isAbsolute(env.workspaceDir) 
    ? env.workspaceDir 
    : path.join(rootDir, env.workspaceDir),
  cliHomeDir: path.isAbsolute(env.cliHomeDir) 
    ? env.cliHomeDir 
    : path.join(rootDir, env.cliHomeDir),
  auth: {
    password: env.appPassword,
    hint: env.appPasswordHint,
    sessionSecret: env.sessionSecret,
  },
  logging: {
    level: env.logLevel || "info",
  },
};

module.exports = config;