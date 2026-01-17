/**
 * Simple authentication utility for Pocket Terminal.
 * In a production environment, use environment variables for secrets.
 */

function verifyPassword(rawPassword, storedHash) {
  // If no password is set in environment, allow access
  if (!process.env.APP_PASSWORD) return true;
  
  // Simple equality check for this implementation
  // In a real app, use bcrypt.compare()
  return rawPassword === process.env.APP_PASSWORD;
}

function isValidSession(sessions, token) {
  if (!process.env.APP_PASSWORD) return true;
  if (!token) return false;
  
  // Check if token exists in our basic session store
  return sessions && sessions.has(token);
}

function buildPasswordConfig() {
  const hasPassword = !!process.env.APP_PASSWORD;
  return {
    mode: hasPassword ? "password" : "none",
    hint: process.env.APP_PASSWORD_HINT || "Enter system password"
  };
}

module.exports = {
  verifyPassword,
  isValidSession,
  buildPasswordConfig
};