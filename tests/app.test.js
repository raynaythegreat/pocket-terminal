// Add unit test for createApp to ensure it exports correctly
const { createApp } = require("../src/app");

describe("createApp", () => {
  it("should export createApp function", () => {
    expect(typeof createApp).toBe("function");
  });
});