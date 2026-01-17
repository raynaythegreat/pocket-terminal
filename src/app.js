const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

const { ensureWorkspaceDirs } = require("./config/paths");
const { requireAuth } = require("./auth/middleware");
const { createToolsRouter } = require("./routes/tools");
const { createAuthRouter } = require("./routes/auth");

function createApp({ config, sessionStore }) {
  // Initialize workspace directories with error handling
  try {
    ensureWorkspaceDirs({
      workspaceDir: config.workspaceDir,
      cliHomeDir: config.cliHomeDir,
    });
    console.log(`✓ Workspace directories initialized`);
    console.log(`  - Workspace: ${config.workspaceDir}`);
    console.log(`  - CLI Home: ${config.cliHomeDir}`);
  } catch (error) {
    console.error(`✗ Failed to initialize workspace directories:`, error.message);
    
    // In production, we might want to exit. In development, continue with warning.
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    
    // For development, create a minimal fallback
    console.warn(`  Continuing in degraded mode. Some features may not work.`);
  }

  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Static UI
  app.use(express.static(path.join(config.rootDir, "public")));

  // API routes
  const authRouter = createAuthRouter({ sessionStore, config });
  app.use("/api", authRouter);

  // Protect remaining API routes when password is set
  app.use("/api", requireAuth({ sessionStore, config }));

  const toolsRouter = createToolsRouter({ config });
  app.use("/api", toolsRouter);

  // Health endpoint (useful for Render)
  app.get("/healthz", (req, res) => res.status(200).send("ok"));

  return app;
}

module.exports = { createApp };