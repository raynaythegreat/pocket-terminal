const { describe, it, expect, beforeEach, vi } = require("vitest");

vi.mock("child_process", () => {
  return {
    spawnSync: vi.fn(),
  };
});

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { isToolAvailable } = require("../src/tools/availability");

function makeConfig() {
  const rootDir = path.join(process.cwd(), "test-fixtures-root");
  return {
    rootDir,
    cliHomeDir: path.join(rootDir, "workspace", "cli-home"),
  };
}

describe("tools availability", () => {
  beforeEach(() => {
    spawnSync.mockReset();
  });

  it("marks subcommand-based tool as available when base command exists", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/gh\n", stderr: "" });

    const config = makeConfig();
    const tool = { id: "copilot", baseCommand: "gh", command: "gh", args: ["copilot"] };

    const ok = isToolAvailable(tool, { config });
    expect(ok).toBe(true);

    // Ensure it checked `gh`
    expect(spawnSync).toHaveBeenCalled();
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(["which", "where"]).toContain(cmd);
    expect(args[0]).toBe("gh");
  });

  it("marks plain command tool as available when command exists on PATH", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/grok\n", stderr: "" });

    const config = makeConfig();
    const tool = { id: "grok", command: "grok", commandCandidates: ["grok"] };

    const ok = isToolAvailable(tool, { config });
    expect(ok).toBe(true);
  });

  it("marks tool as unavailable when command is not found", () => {
    spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

    const config = makeConfig();
    const tool = { id: "grok", command: "grok", commandCandidates: ["grok"] };

    const ok = isToolAvailable(tool, { config });
    expect(ok).toBe(false);
  });
});