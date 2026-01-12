require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TERMINAL_PASSWORD || 'changeme';

// Add node_modules/.bin to PATH for CLI tools
const binPath = path.join(__dirname, 'node_modules', '.bin');
const enhancedPath = `${binPath}:${process.env.PATH}`;

// Create workspace directory for projects
const workspaceDir = process.env.WORKSPACE_DIR || path.join(__dirname, 'workspace');
if (!fs.existsSync(workspaceDir)) {
  fs.mkdirSync(workspaceDir, { recursive: true });
}

// Store active sessions and terminals
const sessions = new Map();
const terminals = new Map();

// Generate session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Auth endpoint
app.post('/auth', (req, res) => {
  const { password } = req.body;

  if (password === PASSWORD) {
    const token = generateToken();
    sessions.set(token, {
      created: Date.now(),
      lastActivity: Date.now()
    });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Validate session token
function isValidSession(token) {
  const session = sessions.get(token);
  if (!session) return false;

  // Session expires after 24 hours
  const maxAge = 24 * 60 * 60 * 1000;
  if (Date.now() - session.created > maxAge) {
    sessions.delete(token);
    return false;
  }

  session.lastActivity = Date.now();
  return true;
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  let authenticated = false;
  let terminal = null;
  let terminalId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // Handle authentication
      if (message.type === 'auth') {
        if (isValidSession(message.token)) {
          authenticated = true;
          terminalId = crypto.randomBytes(8).toString('hex');

          // Spawn terminal with AI CLI tools in PATH
          const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
          terminal = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: message.cols || 80,
            rows: message.rows || 24,
            cwd: workspaceDir,
            env: {
              ...process.env,
              PATH: enhancedPath,
              TERM: 'xterm-256color',
              // Pass through API keys for AI CLIs
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
              OPENAI_API_KEY: process.env.OPENAI_API_KEY,
              GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
              GEMINI_API_KEY: process.env.GEMINI_API_KEY,
              XAI_API_KEY: process.env.XAI_API_KEY,
              GROK_API_KEY: process.env.GROK_API_KEY
            }
          });

          terminals.set(terminalId, terminal);

          // Send terminal output to client
          terminal.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', data }));
            }
          });

          terminal.onExit(({ exitCode }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
            }
            terminals.delete(terminalId);
          });

          ws.send(JSON.stringify({ type: 'authenticated', terminalId }));
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid or expired session' }));
          ws.close();
        }
        return;
      }

      // Require authentication for all other messages
      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      // Handle terminal input
      if (message.type === 'input' && terminal) {
        terminal.write(message.data);
      }

      // Handle terminal resize
      if (message.type === 'resize' && terminal) {
        terminal.resize(message.cols, message.rows);
      }

    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    if (terminal) {
      terminal.kill();
      if (terminalId) {
        terminals.delete(terminalId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Clean up expired sessions periodically
setInterval(() => {
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [token, session] of sessions) {
    if (now - session.created > maxAge) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Check every hour

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`\nAvailable AI CLIs: claude, gemini, codex`);
  console.log(`Workspace directory: ${workspaceDir}`);
});
