/**
 * Backwards-compatible wrapper for older imports/tests.
 * New code should import from src/auth.
 */
const {
  verifyPassword,
  isValidSession,
  buildPasswordConfig,
} = require("./src/auth");

module.exports = {
  verifyPassword: (rawPassword, storedHashIgnored) => {
    // Old signature was (rawPassword, storedHash) but it actually checked env directly.
    // New system reads from config; for compatibility we emulate old behavior:
    const config = {
      auth: {
        password: process.env.APP_PASSWORD || "",
        hint: process.env.APP_PASSWORD_HINT || "Enter system password",
      },
    };
    return verifyPassword(rawPassword, config);
  },

  isValidSession: (sessionsSetOrStore, token) => {
    // Old signature accepted a Set. Maintain that behavior.
    if (!process.env.APP_PASSWORD) return true;
    if (!token) return false;
    if (!sessionsSetOrStore) return false;
    if (typeof sessionsSetOrStore.has === "function") return sessionsSetOrStore.has(token);
    return false;
  },

  buildPasswordConfig: () => {
    const config = {
      auth: {
        password: process.env.APP_PASSWORD || "",
        hint: process.env.APP_PASSWORD_HINT || "Enter system password",
      },
    };
    return buildPasswordConfig(config);
  },
};