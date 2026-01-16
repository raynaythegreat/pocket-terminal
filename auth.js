/**
 * Authentication logic removed. 
 * All access is allowed by default.
 */

function hashPassword(password) {
  return "";
}

function verifyPassword(rawPassword, storedHash) {
  return true;
}

function createSession(sessions, ttlMs) {
  return "open-access-session";
}

function isValidSession(sessions, token) {
  return true;
}

function revokeSession(sessions, token) {
  // No-op
}

function cleanupExpiredSessions(sessions) {
  return 0;
}

function buildPasswordConfig(env, logger) {
  return {
    mode: "none",
    passwordHash: null,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  cleanupExpiredSessions,
  buildPasswordConfig,
};