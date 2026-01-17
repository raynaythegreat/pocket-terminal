const fs = require("fs");
const path = require("path");

describe("tools API (smoke)", () => {
  it("server module loads", async () => {
    process.env.PORT = "0";
    const srv = require("../server");
    expect(srv).toBeTruthy();
    expect(typeof srv.listen).toBe("function");
  });

  it("repo includes opencode launcher script", () => {
    const p = path.resolve(__dirname, "..", "opencode");
    expect(fs.existsSync(p)).toBe(true);
  });
});