/**
 * Legacy server entry point - redirects to new architecture.
 * This file maintains backwards compatibility while the new architecture is in src/.
 */

const { createServer } = require("./src/server");

// Export the new server creation function
module.exports = createServer().server;

// If this file is run directly, delegate to the new server
if (require.main === module) {
  const { server } = createServer();
  
  // The new server handles its own startup
  // This is just for backwards compatibility
}