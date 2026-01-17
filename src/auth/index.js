/**
 * Authentication utilities for Pocket Terminal.
 * Clean, focused authentication logic without backwards compatibility.
 */

const { logger } = require("../utils/logger");

function hasPasswordSet(config) {
  return !!(config && config.auth && config.auth.password);
}

function verifyPassword(rawPassword, config) {
  if (!hasPasswordSet(config)) {
    logger.debug("No password set, allowing access");
    return true;
  }
  
  const isValid = rawPassword === config.auth.password;
  if (!isValid) {
    logger.debug("Password verification failed");
  }
  
  return isValid;
}

function isValidSession(sessionStore, token, config) {
  if (!hasPasswordSet(config)) {
    logger.debug("No password set, session is valid");
    return true;
  }
  
  if (!token) {
    logger.debug("No token provided");
    return false;
  }
  
  const isValid = !!sessionStore && sessionStore.has(token);
  if (!isValid) {
    logger.debug("Invalid session token");
  }
  
  return isValid;
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