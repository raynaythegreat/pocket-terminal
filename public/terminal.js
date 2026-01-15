
- Implement or fix `launchCLI(tool, args?)`:

  - Set some global `currentTool`.
  - Open WebSocket with query `?tool=${encodeURIComponent(tool)}`.
  - Show terminal screen and update header/label to indicate which tool is running.

- Improve UX:

  - If WebSocket closes quickly with an error (e.g., unable to spawn tool), show a toast with a clear message.
  - When connecting to a tool, show a small “Connecting to X…” status in the header.

- On page load or login success, optionally call `/tools` to:
  - Disable cards for tools that are definitely unavailable.
  - Possibly show a tooltip “Not installed on server”.

#### 4) Tests / config

- Ensure tests still pass (auth tests already in place).
- No extra test suite is strictly required for CLI spawning, but we can:
  - Add a small unit for the tool mapping function if we extract it, or
  - At least ensure we don’t crash when a tool binary is missing — handled at runtime with try/catch.

---

## Assumptions & questions

Before I write concrete changes:

1. Are `kimi` and `opencode` indeed the two scripts you want “brought back” as CLIs?
2. Are the extra AI CLIs (Claude/Gemini/etc.) actually installed on your Render image, or should we:
   - Just wire them up and gracefully show “tool not installed” until you install them?
3. Are you okay with:
   - A `/tools` endpoint used by the UI to detect availability?
   - A simple “best effort” check (local scripts: real check; external CLIs: assume missing unless you want me to add `which`-based detection)?

If my assumptions are correct, I’ll:

- Update `server.js` with tool spawning and `/tools`.
- Update `public/index.html` CLI grid to match.
- Update `public/terminal.js` with a robust `launchCLI` and better error handling.

Reply confirming (and clarifying 1–3 if needed), and I’ll generate the exact FILE CHANGES.