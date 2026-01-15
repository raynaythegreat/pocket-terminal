
- Add a route:

  ```js
  app.get("/tools", requireAuth, async (req, res) => {
    // Build a list of tools with { id, title, available, reason? }
    // For local scripts: use fs.existsSync
    // For optional CLIs: just mark them as "maybe" or "requires install"
  });
  ```

- To keep it simple and portable, we’ll:
  - Mark local scripts as `available` if the file exists and is executable.
  - For external CLIs (Claude, Gemini, etc.), just mark them as “requires install” (available: false) unless you want to run a `which` process; for Render and reliability, it’s better to avoid that unless needed.

#### 3) Frontend: wire `launchCLI` and CLI cards correctly