wss.on("connection", (ws) => {
  // Add error handling for WebSocket connections
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});