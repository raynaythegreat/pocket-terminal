const { getToolById } = require("../tools/registry");
const { checkCommand } = require("../tools/availability");
const { spawnToolPty } = require("./ptyManager");
const { wsIsAuthorized } = require("../auth/middleware");

/**
 * WebSocket protocol:
 * - client sends: {type:"input", data:string}
 * - client sends: {type:"resize", cols:number, rows:number}
 * - server sends: raw PTY output strings (for xterm.js term.write)
 */
function attachTerminalWebSocketServer({ wss, config, sessionStore }) {
  wss.on("connection", (ws, req) => {
    // Auth gate
    if (!wsIsAuthorized({ sessionStore, config, req })) {
      try {
        ws.send("Unauthorized\r\n");
      } catch {
        // ignore
      }
      ws.close(1008, "Unauthorized"); // Policy Violation
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const toolId = url.searchParams.get("tool") || "shell";
    const tool = getToolById(toolId);

    // Block spawning tools that are not available (but allow shell fallback).
    const ready = checkCommand(tool.cmd, { rootDir: config.rootDir });
    if (!ready) {
      const msg = `Tool not found: ${tool.name} (${tool.cmd})\r\n`;
      try {
        ws.send(msg);
      } catch {
        // ignore
      }
      ws.close(1011, "Tool not available");
      return;
    }

    const ptyProcess = spawnToolPty({ tool, config });

    const safeSend = (data) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(data);
        } catch {
          // ignore
        }
      }
    };

    ptyProcess.onData((data) => safeSend(data));
    ptyProcess.onExit(({ exitCode, signal }) => {
      safeSend(`\r\n[process exited] code=${exitCode} signal=${signal || ""}\r\n`);
      try {
        ws.close();
      } catch {
        // ignore
      }
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }

      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "input" && typeof msg.data === "string") {
        try {
          ptyProcess.write(msg.data);
        } catch {
          // ignore
        }
        return;
      }

      if (
        msg.type === "resize" &&
        Number.isFinite(msg.cols) &&
        Number.isFinite(msg.rows) &&
        msg.cols > 0 &&
        msg.rows > 0
      ) {
        try {
          ptyProcess.resize(msg.cols, msg.rows);
        } catch {
          // ignore
        }
      }
    });

    ws.on("close", () => {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
    });

    ws.on("error", () => {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
    });
  });
}

module.exports = { attachTerminalWebSocketServer };