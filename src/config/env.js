const path = require("path");

function boolFromEnv(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultValue;
}

function loadConfig() {
  const rootDir = path.resolve(__dirname, "..", "..");

  const port = Number(process.env.PORT || 3000);

  const workspaceDir =
    process.env.WORKSPACE_DIR || path.join(rootDir, "workspace", "projects");
  const cliHomeDir =
    process.env.CLI_HOME_DIR || path.join(rootDir, "workspace", "cli-home");

  const nodeEnv = process.env.NODE_ENV || "development";

  // Prefer security defaults without breaking local dev.
  const cookiesSecure =
    process.env.COOKIE_SECURE != null
      ? boolFromEnv(process.env.COOKIE_SECURE, nodeEnv === "production")
      : nodeEnv === "production";

  const appPassword = process.env.APP_PASSWORD || "";
  const appPasswordHint = process.env.APP_PASSWORD_HINT || "Enter system password";

  return {
    rootDir,
    port,
    nodeEnv,
    workspaceDir,
    cliHomeDir,
    cookies: {
      secure: cookiesSecure,
    },
    auth: {
      password: appPassword,
      hint: appPasswordHint,
    },
  };
}

module.exports = { loadConfig };