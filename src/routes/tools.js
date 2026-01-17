const express = require("express");
const { listTools } = require("../tools/registry");
const { checkCommand } = require("../tools/availability");

function createToolsRouter({ config }) {
  const router = express.Router();

  router.get("/tools", (req, res) => {
    const tools = listTools();
    const availableTools = tools.map((tool) => ({
      ...tool,
      ready: checkCommand(tool.cmd, { rootDir: config.rootDir }),
    }));
    res.json(availableTools);
  });

  return router;
}

module.exports = { createToolsRouter };