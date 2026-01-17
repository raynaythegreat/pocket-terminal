const WebSocket = require("ws");
const { createPty, formatSpawnErrorMessage } = require("./ptyManager");
const { wsIsAuthorized } = require("../auth/middleware");

function attachTerminalWs({ server, config, sessionStore, toolsRegistry }) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) return;
    if (!wsIsAuthorized({ sessionStore, config, req })) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    let ptyProcess = null;

    ws.on("message", (msg) => {
      let data;
      try {
        data = JSON.parse(msg.toString());
      } catch {
        return;
      }

      if (data.type === "start") {
        const toolId = data.toolId || "shell";
        const tool = toolsRegistry.find((t) => t.id === toolId) || toolsRegistry[0];

        try {
          ptyProcess = createPty({ config, tool });

          ptyProcess.onData((chunk) => {
            try {
              ws.send(JSON.stringify({ type: "output", data: chunk }));
            } catch {
              // ignore
            }
          });

          ptyProcess.onExit(({ exitCode, signal }) => {
            const msgOut = `\r\n[process exited] code=${exitCode}${signal ? ` signal=${signal}` : ""}\r\n`;
            try {
              ws.send(JSON.stringify({ type: "output", data: msgOut }));
            } catch {
              // ignore
            }
          });
        } catch (err) {
          const errMsg = formatSpawnErrorMessage({ tool, err, config });
          try {
            ws.send(JSON.stringify({ type: "output", data: errMsg }));
          } catch {
            // ignore
          }
        }
      }

      if (data.type === "input") {
        if (ptyProcess) {
          try {
            ptyProcess.write(String(data.data || ""));
          } catch {
            // ignore
          }
        }
      }

      if (data.type === "resize") {
        if (ptyProcess && data.cols && data.rows) {
          try {
            ptyProcess.resize(Number(data.cols), Number(data.rows));
          } catch {
            // ignore
          }
        }
      }
    });

    ws.on("close", () => {
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // ignore
        }
      }
    });
  });

  return wss;
}

module.exports = { attachTerminalWs };