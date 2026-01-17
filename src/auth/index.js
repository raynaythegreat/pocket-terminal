/**
 * Authentication utilities for Pocket Terminal.
 * NOTE: This remains intentionally simple. If APP_PASSWORD is unset, the app is open.
 */

function hasPasswordSet(config) {
  return !!(config && config.auth && config.auth.password);
}

function verifyPassword(rawPassword, config) {
  if (!hasPasswordSet(config)) return true;
  return rawPassword === config.auth.password;
}

function isValidSession(sessionStore, token, config) {
  if (!hasPasswordSet(config)) return true;
  if (!token) return false;
  return !!sessionStore && sessionStore.has(token);
}

function buildPasswordConfig(config) {
  const enabled = hasPasswordSet(config);
  return {
    mode: enabled ? "password" : "none",
    hint: (config && config.auth && config.auth.hint) || "Enter system password",
  };
}

module.exports = {
  verifyPassword,
  isValidSession,
  buildPasswordConfig,
  hasPasswordSet,
};