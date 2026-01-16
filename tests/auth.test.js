// vitest globals are available via config
const {
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  revokeSession,
  buildPasswordConfig,
} = require("../auth");

describe("auth utilities", () => {
  it("hashPassword produces deterministic output", () => {
    const p = "test-password";
    const a = hashPassword(p);
    const b = hashPassword(p);
    expect(a).toBeTypeOf("string");
    expect(a).toBe(b);
  });

  it("verifyPassword returns true for correct password", () => {
    const pwd = "secret123";
    const hash = hashPassword(pwd);
    expect(verifyPassword(pwd, hash)).toBe(true);
  });

  it("verifyPassword returns false for wrong password", () => {
    const pwd = "secret123";
    const hash = hashPassword(pwd);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("verifyPassword returns false if storedHash is null", () => {
    expect(verifyPassword("anything", null)).toBe(false);
  });

  it("session lifecycle works as expected", () => {
    const sessions = new Map();
    const ttl = 50; // 50ms
    const token = createSession(sessions, ttl);

    expect(token).toBeTypeOf("string");
    expect(isValidSession(sessions, token)).toBe(true);

    revokeSession(sessions, token);
    expect(isValidSession(sessions, token)).toBe(false);
  });

  it("expired sessions are invalid", async () => {
    const sessions = new Map();
    const ttl = 10; // 10ms
    const token = createSession(sessions, ttl);

    expect(isValidSession(sessions, token)).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(isValidSession(sessions, token)).toBe(false);
  });

  describe("buildPasswordConfig", () => {
    it("uses env password when provided", () => {
      const logger = { info: () => {}, warn: () => {} };
      const cfg = buildPasswordConfig(
        { TERMINAL_PASSWORD: "abc", NODE_ENV: "production" },
        logger
      );
      expect(cfg.mode).toBe("env");
      expect(cfg.passwordHash).toBe(hashPassword("abc"));
    });

    it("is misconfigured in production when TERMINAL_PASSWORD is missing", () => {
      const log = { messages: [] };
      const logger = {
        warn: (m) => log.messages.push(m),
        info: () => {},
      };
      const cfg = buildPasswordConfig(
        { NODE_ENV: "production" },
        logger
      );
      expect(cfg.mode).toBe("misconfigured");
      expect(cfg.passwordHash).toBeNull();
      expect(log.messages.length).toBeGreaterThan(0);
    });

    it("uses default password in non-production when TERMINAL_PASSWORD is missing", () => {
      const logger = { warn: () => {}, info: () => {} };
      const cfg = buildPasswordConfig(
        { NODE_ENV: "development" },
        logger
      );
      expect(cfg.mode).toBe("default");
      expect(cfg.passwordHash).toBe(hashPassword("Superprimitive69!"));
    });
  });
});