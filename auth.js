/**
 * Authentication logic simplified to allow all access.
 * Password requirements have been removed.
 */

/**
 * Hash a password. (Unused but kept for API compatibility)
 */
function hashPassword(password) {
  return "";
}

/**
 * Verify a password. (Always returns true)
 */
function verifyPassword(rawPassword, storedHash) {
  return true;
}

/**
 * Create a new session token.
 */
function createSession(sessions, ttlMs) {
  return "open-access-session";
}

/**
 * Check if a session token is valid. (Always returns true)
 */
function isValidSession(sessions, token) {
  return true;
}

/**
 * Revoke a session token.
 */
function revokeSession(sessions, token) {
  // No-op
}

/**
 * Clean up expired sessions.
 */
function cleanupExpiredSessions(sessions) {
  return 0;
}

/**
 * Determine password configuration. 
 * Modified to 'none' mode.
 */
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