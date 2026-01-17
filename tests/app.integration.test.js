const request = require("supertest");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createApp } = require("../src/app");
const { createMemorySessionStore } = require("../src/auth/sessionStore");

describe("App Integration", () => {
  let testRoot;
  let config;
  let sessionStore;

  beforeEach(() => {
    // Create temporary test directory
    testRoot = path.join(os.tmpdir(), `pocket-terminal-integration-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });

    // Create minimal public directory structure
    const publicDir = path.join(testRoot, "public");
    fs.mkdirSync(publicDir);
    fs.writeFileSync(path.join(publicDir, "index.html"), "<html>test</html>");

    // Mock config
    config = {
      rootDir: testRoot,
      workspaceDir: path.join(testRoot, "workspace"),
      cliHomeDir: path.join(testRoot, "cli-home"),
      port: 3000,
      auth: {
        password: "",
        hint: "Enter password",
      },
    };

    sessionStore = createMemorySessionStore();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should start successfully and create workspace directories", async () => {
    const app = createApp({ config, sessionStore });

    // Verify directories were created
    expect(fs.existsSync(config.workspaceDir)).toBe(true);
    expect(fs.existsSync(config.cliHomeDir)).toBe(true);
    expect(fs.existsSync(path.join(config.cliHomeDir, "tools"))).toBe(true);

    // Verify app serves static files
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
  });

  it("should continue in development mode if directory creation fails", () => {
    // Create a file where we want a directory to simulate conflict
    fs.writeFileSync(config.workspaceDir, "not a directory");

    // Mock NODE_ENV to development
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    // Should not throw, but log error
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

    const app = createApp({ config, sessionStore });

    expect(app).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to initialize workspace directories"),
      expect.any(String)
    );

    consoleErrorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  it("should throw in production mode if directory creation fails", () => {
    // Create a file where we want a directory to simulate conflict
    fs.writeFileSync(config.workspaceDir, "not a directory");

    // Mock NODE_ENV to production
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    expect(() => createApp({ config, sessionStore })).toThrow();

    process.env.NODE_ENV = originalEnv;
  });

  it("should protect API routes when password is set", async () => {
    config.auth.password = "test-password";

    const app = createApp({ config, sessionStore });

    // Try to access protected endpoint without auth
    const response = await request(app).get("/api/tools");
    expect(response.status).toBe(401);
  });

  it("should serve health check endpoint", async () => {
    const app = createApp({ config, sessionStore });

    const response = await request(app).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.text).toBe("ok");
  });
});