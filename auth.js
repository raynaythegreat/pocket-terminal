const crypto = require("crypto");

/**
 * Hash a password using SHA-256.
 * NOTE: This is intentionally simple for CLI-style auth.
 * For real multi-user systems, use a strong KDF (bcrypt/scrypt/argon2).
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  const value = String(password == null ? "" : password);
  return crypto.createHash("sha256").update(value.trim()).digest("hex");
}

/**
 * Verify a raw password against a stored hash.
 * @param {string} rawPassword
 * @param {string | null} storedHash
 * @returns {boolean}
 */
function verifyPassword(rawPassword, storedHash) {
  if (!storedHash) return false;
  const candidate = hashPassword(rawPassword);
  // Use timing-safe comparison where available
  try {
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    // Fallback if timingSafeEqual throws for any reason
    return candidate === storedHash;
  }
}

/**
 * Create a new session token in the provided sessions map.
 * @param {Map<string, { expiresAt: number }>} sessions
 * @param {number} ttlMs
 * @returns {string} token
 */
function createSession(sessions, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  sessions.set(token, { expiresAt });
  return token;
}

/**
 * Check if a session token is valid.
 * @param {Map<string, { expiresAt: number }>} sessions
 * @param {string | null | undefined} token
 * @returns {boolean}
 */
function isValidSession(sessions, token) {
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Revoke a session token.
 * @param {Map<string, { expiresAt: number }>} sessions
 * @param {string | null | undefined} token
 */
function revokeSession(sessions, token) {
  if (!token) return;
  sessions.delete(token);
}

/**
 * Determine password configuration based on environment.
 *
 * Modes:
 * - "env":        using TERMINAL_PASSWORD from env
 * - "default":    using built-in default password (non-production only)
 * - "misconfigured": TERMINAL_PASSWORD missing in production; no logins allowed
 *
 * @param {{ TERMINAL_PASSWORD?: string | undefined, NODE_ENV?: string | undefined }} env
 * @param {{ warn: Function, info?: Function }} logger
 * @returns {{ mode: "env" | "default" | "misconfigured", passwordHash: string | null }}
 */
function buildPasswordConfig(env, logger) {
  const envPassword = env.TERMINAL_PASSWORD;
  const nodeEnv = env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

  if (envPassword && envPassword.trim().length > 0) {
    if (logger && typeof logger.info === "function") {
      logger.info("Using TERMINAL_PASSWORD from environment.");
    }
    return {
      mode: "env",
      passwordHash: hashPassword(envPassword),
    };
  }

  if (isProd) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        "TERMINAL_PASSWORD is NOT set in production. Authentication is disabled until it is configured."
      );
    }
    return {
      mode: "misconfigured",
      passwordHash: null,
    };
  }

  if (logger && typeof logger.warn === "function") {
    logger.warn(
      "TERMINAL_PASSWORD not set. Using default development password. Do NOT use this setup in production."
    );
  }

  const defaultPassword = "Superprimitive69!";
  return {
    mode: "default",
    passwordHash: hashPassword(defaultPassword),
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  buildPasswordConfig,
};