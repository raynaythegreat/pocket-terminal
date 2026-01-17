const dotenv = require("dotenv");
dotenv.config();

const { loadConfig } = require("./src/config/env");
const { createServer } = require("./src/server");

const config = loadConfig();
const { server } = createServer({ config });

const PORT = config.port;

// Only listen when run directly (supports tests requiring the module).
if (require.main === module) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Pocket Terminal listening on port ${PORT}`);
  });
}

module.exports = server;