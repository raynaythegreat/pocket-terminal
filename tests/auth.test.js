const {
  verifyPassword,
  isValidSession,
  buildPasswordConfig,
} = require("../auth");

describe("auth utilities (disabled mode)", () => {
  it("verifyPassword always returns true", () => {
    expect(verifyPassword("anything", "anything")).toBe(true);
    expect(verifyPassword("", null)).toBe(true);
  });

  it("isValidSession always returns true", () => {
    const sessions = new Map();
    expect(isValidSession(sessions, "any-token")).toBe(true);
  });

  describe("buildPasswordConfig", () => {
    it("returns mode 'none'", () => {
      const logger = { info: () => {}, warn: () => {} };
      const cfg = buildPasswordConfig({}, logger);
      expect(cfg.mode).toBe("none");
      expect(cfg.passwordHash).toBeNull();
    });
  });
});