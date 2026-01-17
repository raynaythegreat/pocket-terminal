/**
 * Tool registry: single source of truth for the launcher UI and websocket spawn.
 * Keep IDs stable because they’re used in URLs and per-tool HOME persistence.
 */
const TOOLS = [
  { id: "shell", name: "Terminal", cmd: "bash", category: "core" },
  { id: "claude", name: "Claude Code", cmd: "claude", category: "ai" },
  { id: "gemini", name: "Gemini CLI", cmd: "gemini", category: "ai" },
  { id: "copilot", name: "Copilot", cmd: "github-copilot", category: "ai" },
  { id: "grok", name: "Grok CLI", cmd: "grok", category: "ai" },
  { id: "opencode", name: "OpenCode", cmd: "./opencode", category: "core" },
  { id: "kimi", name: "Kimi", cmd: "./kimi", category: "ai" },
];

function listTools() {
  return [...TOOLS];
}

function getToolById(id) {
  return TOOLS.find((t) => t.id === id) || TOOLS[0];
}

module.exports = {
  TOOLS,
  listTools,
  getToolById,
};