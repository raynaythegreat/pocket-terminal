const {
  verifyPassword,
  isValidSession,
  buildPasswordConfig,
} = require("../auth");

describe("auth utilities (no-auth mode)", () => {
  it("verifyPassword always returns true", () => {
    expect(verifyPassword("anything", "anything")).toBe(true);
  });

  it("isValidSession always returns true", () => {
    expect(isValidSession(null, "any-token")).toBe(true);
  });

  describe("buildPasswordConfig", () => {
    it("returns mode 'none'", () => {
      const cfg = buildPasswordConfig({}, {});
      expect(cfg.mode).toBe("none");
    });
  });
});