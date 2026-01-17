const WebSocket = require("ws");
const { spawnPty } = require("./ptyManager");
const { requireAuthWs } = require("../auth/middleware");

function attachTerminalWebSocketServer({ wss, config, sessionStore }) {
  wss.on("connection", (ws, req) => {
    // Extract tool ID from URL path
    const urlParts = req.url.split("/");
    const toolId = urlParts[urlParts.length - 1];

    // Auth check (if password is set)
    if (!requireAuthWs(ws, req, sessionStore, config)) {
      return;
    }

    console.log(`New WebSocket connection for tool: ${toolId}`);

    let pty = null;

    try {
      pty = spawnPty({ toolId, config });
      console.log(`Spawned PTY for ${toolId} with PID ${pty.pid}`);
    } catch (error) {
      console.error(`Failed to spawn PTY for ${toolId}:`, error);
      ws.send(JSON.stringify({ type: "error", message: "Failed to start terminal" }));
      ws.close();
      return;
    }

    // Forward PTY output to WebSocket
    pty.onData((data) => {
      ws.send(JSON.stringify({ type: "data", data }));
    });

    // Handle PTY exit
    pty.onExit(({ exitCode, signal }) => {
      console.log(`PTY for ${toolId} exited with code ${exitCode}, signal ${signal}`);
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    });

    // Handle WebSocket messages
    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message);
        
        if (msg.type === "input" && pty) {
          pty.write(msg.data);
        } else if (msg.type === "resize" && pty) {
          pty.resize(msg.cols, msg.rows);
        }
      } catch (error) {
        console.error("Error handling WebSocket message:", error);
      }
    });

    // Handle WebSocket close
    ws.on("close", () => {
      console.log(`WebSocket connection closed for tool: ${toolId}`);
      if (pty) {
        pty.kill();
      }
    });

    // Handle WebSocket errors
    ws.on("error", (error) => {
      console.error(`WebSocket error for tool ${toolId}:`, error);
      if (pty) {
        pty.kill();
      }
    });

    // Send initial terminal size
    ws.send(JSON.stringify({ type: "ready" }));
  });
}

module.exports = {
  attachTerminalWebSocketServer,
};