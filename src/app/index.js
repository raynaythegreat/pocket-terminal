/**
 * Express application setup and configuration.
 * This module creates and configures the Express app with all middleware and routes.
 */

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

const { ensureWorkspaceDirs } = require("../config/paths");
const { requireAuth } = require("../auth/middleware");
const { createToolsRouter } = require("../routes/tools");
const { createAuthRouter } = require("../routes/auth");
const { logger } = require("../utils/logger");

function createApp({ config, sessionStore }) {
  // Initialize workspace directories with error handling
  try {
    ensureWorkspaceDirs({
      workspaceDir: config.workspaceDir,
      cliHomeDir: config.cliHomeDir,
    });
    logger.info("Workspace directories initialized");
    logger.info(`  - Workspace: ${config.workspaceDir}`);
    logger.info(`  - CLI Home: ${config.cliHomeDir}`);
  } catch (error) {
    logger.error("Failed to initialize workspace directories:", error.message);
    
    // In production, we might want to exit. In development, continue with warning.
    if (config.nodeEnv === "production") {
      throw error;
    }
    
    // For development, create a minimal fallback
    logger.warn("Continuing in degraded mode. Some features may not work.");
  }

  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(cookieParser());

  // Request logging middleware
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Static UI files
  app.use(express.static(path.join(config.rootDir, "public")));

  // API routes
  const authRouter = createAuthRouter({ sessionStore, config });
  app.use("/api", authRouter);

  // Protect remaining API routes when password is set
  app.use("/api", requireAuth({ sessionStore, config }));

  const toolsRouter = createToolsRouter({ config });
  app.use("/api", toolsRouter);

  // Health endpoint (useful for Render and monitoring)
  app.get("/healthz", (req, res) => {
    res.status(200).json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      version: require("../../package.json").version
    });
  });

  // Catch-all handler for undefined routes
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error("Unhandled error:", err);
    res.status(500).json({ 
      error: config.nodeEnv === "production" ? "Internal server error" : err.message 
    });
  });

  return app;
}

module.exports = { createApp };