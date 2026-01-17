const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

const { ensureWorkspaceDirs } = require("./config/paths");
const { requireAuth } = require("./auth/middleware");
const { createToolsRouter } = require("./routes/tools");
const { createAuthRouter } = require("./routes/auth");

function createApp({ config, sessionStore }) {
  ensureWorkspaceDirs({
    workspaceDir: config.workspaceDir,
    cliHomeDir: config.cliHomeDir,
  });

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