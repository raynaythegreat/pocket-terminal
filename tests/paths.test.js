const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  ensureWorkspaceDirs,
  ensureDir,
  getToolHomeDir,
  getToolEnv,
} = require("../src/config/paths");

describe("config/paths", () => {
  let testRoot;

  beforeEach(() => {
    // Create temporary test directory
    testRoot = path.join(os.tmpdir(), `pocket-terminal-test-${Date.now()}`);
    fs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("ensureDir", () => {
    it("should create directory if it does not exist", () => {
      const newDir = path.join(testRoot, "new-dir");
      expect(fs.existsSync(newDir)).toBe(false);

      ensureDir(newDir);

      expect(fs.existsSync(newDir)).toBe(true);
      expect(fs.statSync(newDir).isDirectory()).toBe(true);
    });

    it("should not throw if directory already exists", () => {
      const existingDir = path.join(testRoot, "existing-dir");
      fs.mkdirSync(existingDir);

      expect(() => ensureDir(existingDir)).not.toThrow();
    });

    it("should throw error if path exists but is not a directory", () => {
      const filePath = path.join(testRoot, "file.txt");
      fs.writeFileSync(filePath, "test");

      expect(() => ensureDir(filePath)).toThrow("Path exists but is not a directory");
    });

    it("should create nested directories recursively", () => {
      const nestedDir = path.join(testRoot, "a", "b", "c");
      ensureDir(nestedDir);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });

  describe("ensureWorkspaceDirs", () => {
    it("should create all required directories", () => {
      const workspaceDir = path.join(testRoot, "workspace");
      const cliHomeDir = path.join(testRoot, "cli-home");

      const result = ensureWorkspaceDirs({ workspaceDir, cliHomeDir });

      expect(fs.existsSync(workspaceDir)).toBe(true);
      expect(fs.existsSync(cliHomeDir)).toBe(true);
      expect(fs.existsSync(path.join(cliHomeDir, "tools"))).toBe(true);
      expect(result.success).toBe(true);
      expect(result.workspaceDir).toBe(workspaceDir);
      expect(result.cliHomeDir).toBe(cliHomeDir);
    });

    it("should throw error if workspaceDir is missing", () => {
      expect(() => ensureWorkspaceDirs({ cliHomeDir: "/tmp" })).toThrow(
        "Missing required directory paths"
      );
    });

    it("should throw error if cliHomeDir is missing", () => {
      expect(() => ensureWorkspaceDirs({ workspaceDir: "/tmp" })).toThrow(
        "Missing required directory paths"
      );
    });

    it("should handle existing directories gracefully", () => {
      const workspaceDir = path.join(testRoot, "workspace");
      const cliHomeDir = path.join(testRoot, "cli-home");
      fs.mkdirSync(workspaceDir);
      fs.mkdirSync(cliHomeDir);

      expect(() => ensureWorkspaceDirs({ workspaceDir, cliHomeDir })).not.toThrow();
    });

    it("should set restrictive permissions on cliHomeDir", () => {
      const cliHomeDir = path.join(testRoot, "cli-home");
      
      ensureWorkspaceDirs({ workspaceDir: testRoot, cliHomeDir });

      const stats = fs.statSync(cliHomeDir);
      // Check that owner has rwx, others have none (0o700)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });

    it("should continue if chmod fails", () => {
      const cliHomeDir = path.join(testRoot, "cli-home");
      // Create a nested path that will succeed but chmod might fail in some scenarios
      fs.mkdirSync(cliHomeDir, { recursive: true });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      ensureWorkspaceDirs({ workspaceDir: testRoot, cliHomeDir });

      // Should complete without throwing
      expect(fs.existsSync(cliHomeDir)).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe("getToolHomeDir", () => {
    it("should return correct tool home directory path", () => {
      const cliHomeDir = "/home/cli";
      const toolId = "test-tool";

      const result = getToolHomeDir(cliHomeDir, toolId);

      expect(result).toBe(path.join(cliHomeDir, "tools", toolId));
    });

    it("should throw error for invalid toolId", () => {
      expect(() => getToolHomeDir("/home/cli", "")).toThrow("Invalid toolId");
      expect(() => getToolHomeDir("/home/cli", null)).toThrow("Invalid toolId");
      expect(() => getToolHomeDir("/home/cli", 123)).toThrow("Invalid toolId");
    });
  });

  describe("getToolEnv", () => {
    it("should return correct environment variables", () => {
      const toolHomeDir = "/home/cli/tools/test-tool";

      const env = getToolEnv(toolHomeDir);

      expect(env).toEqual({
        HOME: toolHomeDir,
        XDG_CONFIG_HOME: path.join(toolHomeDir, ".config"),
        XDG_DATA_HOME: path.join(toolHomeDir, ".local", "share"),
        XDG_CACHE_HOME: path.join(toolHomeDir, ".cache"),
      });
    });
  });
});