function buildTool({
  id,
  name,
  category,
  command,
  args = [],
  description = "",
  installHint = "",
  commandCandidates = [],
  // If provided, tool is considered available if `baseCommand` is available
  // (useful for tools that run as subcommands, e.g. `gh copilot`).
  baseCommand = "",
}) {
  return {
    id,
    name,
    category,
    command,
    args,
    description,
    installHint,
    commandCandidates,
    baseCommand,
  };
}

/**
 * Tool registry used by the launcher. "Ready" is determined by availability probing.
 *
 * Categories:
 * - core: normal terminal/shell tools
 * - ai: AI assistant CLIs
 */
function getToolsRegistry() {
  return [
    buildTool({
      id: "shell",
      name: "Terminal",
      category: "core",
      command: "bash",
      args: ["-l"],
      description: "Standard interactive shell.",
      installHint: "Should be available on most systems.",
      commandCandidates: ["bash", "sh"],
    }),

    buildTool({
      id: "opencode",
      name: "OpenCode",
      category: "ai",
      command: "opencode",
      args: [],
      description: "OpenCode CLI (repo script).",
      installHint: "Run ./build.sh to populate ./bin, or ensure ./opencode is executable.",
      commandCandidates: ["opencode", "./opencode"],
    }),

    buildTool({
      id: "claude",
      name: "Claude Code",
      category: "ai",
      command: "claude",
      args: [],
      description: "Anthropic Claude Code CLI.",
      installHint: "Installed via npm dependency @anthropic-ai/claude-code. Run npm ci then ./build.sh.",
      commandCandidates: ["claude"],
    }),

    buildTool({
      id: "gemini",
      name: "Gemini CLI",
      category: "ai",
      command: "gemini",
      args: [],
      description: "Google Gemini CLI.",
      installHint:
        "Installed via npm dependency @google/gemini-cli. On headless servers use the no-browser login flow.",
      commandCandidates: ["gemini"],
    }),

    // Copilot: prefer GitHub CLI integration (headless-friendly auth via `gh auth login`).
    buildTool({
      id: "copilot",
      name: "GitHub Copilot (gh)",
      category: "ai",
      command: "gh",
      args: ["copilot"],
      description: "GitHub Copilot via GitHub CLI.",
      installHint:
        "Requires GitHub CLI (`gh`) on the host. Authenticate with `gh auth login` (device code works headless).",
      baseCommand: "gh",
    }),

    // Grok CLI: installed as a local dependency so it works on Render reliably.
    buildTool({
      id: "grok",
      name: "Grok CLI",
      category: "ai",
      command: "grok",
      args: [],
      description: "Grok CLI (@vibe-kit/grok-cli).",
      installHint: "Installed via npm dependency @vibe-kit/grok-cli. Run npm ci then ./build.sh.",
      commandCandidates: ["grok"],
    }),
  ];
}

module.exports = { getToolsRegistry };