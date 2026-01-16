describe("tools API (smoke)", () => {
  it("server module loads", async () => {
    process.env.PORT = "0";
    const srv = require("../server");
    expect(srv).toBeTruthy();
  });
});