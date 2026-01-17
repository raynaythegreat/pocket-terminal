const http = require("http");
const { WebSocketServer } = require("ws");

const { createApp } = require("./app");
const { SessionStore } = require("./auth/sessionStore");
const { attachTerminalWebSocketServer } = require("./terminal/wsHandler");

function createServer({ config }) {
  const sessionStore = new SessionStore();
  const app = createApp({ config, sessionStore });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  attachTerminalWebSocketServer({ wss, config, sessionStore });

  return { app, server, wss, sessionStore };
}

module.exports = { createServer };