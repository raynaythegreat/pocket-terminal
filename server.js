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

// Available CLI tools configuration
const CLI_TOOLS = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    description: 'Anthropic Claude AI coding assistant',
    envKey: 'ANTHROPIC_API_KEY'
  },
  gemini: {
    name: 'Gemini CLI',
    command: 'gemini',
    description: 'Google Gemini AI assistant',
    envKey: 'GEMINI_API_KEY'
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    description: 'OpenAI Codex coding assistant',
    envKey: 'OPENAI_API_KEY'
  },
  grok: {
    name: 'Grok',
    command: 'grok',
    description: 'xAI Grok assistant',
    envKey: 'XAI_API_KEY'
  },
  kimi: {
    name: 'Kimi K2',
    command: 'kimi',
    description: 'Moonshot Kimi K2 assistant',
    envKey: 'KIMI_API_KEY'
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    description: 'Open source coding assistant',
    envKey: 'OPENCODE_API_KEY'
  },
  bash: {
    name: 'Bash Shell',
    command: 'bash',
    description: 'Standard bash terminal',
    envKey: null
  }
};

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

// Get available CLIs endpoint
app.get('/api/clis', (req, res) => {
  const clis = Object.entries(CLI_TOOLS).map(([id, cli]) => ({
    id,
    name: cli.name,
    description: cli.description,
    available: cli.envKey ? !!process.env[cli.envKey] : true
  }));
  res.json(clis);
});

// Validate session token
function isValidSession(token) {
  const session = sessions.get(token);
  if (!session) return false;

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
  let currentCli = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // Handle authentication
      if (message.type === 'auth') {
        if (isValidSession(message.token)) {
          authenticated = true;
          ws.send(JSON.stringify({ type: 'authenticated' }));
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

      // Handle launching a CLI
      if (message.type === 'launch') {
        const cliId = message.cli || 'bash';
        const cli = CLI_TOOLS[cliId];

        if (!cli) {
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown CLI tool' }));
          return;
        }

        // Kill existing terminal if any
        if (terminal) {
          terminal.kill();
          terminals.delete(terminalId);
        }

        terminalId = crypto.randomBytes(8).toString('hex');
        currentCli = cliId;

        // Determine shell and args
        let shell, args;
        if (cliId === 'bash') {
          shell = 'bash';
          args = [];
        } else {
          shell = cli.command;
          args = [];
        }

        // Build environment
        const termEnv = {
          ...process.env,
          PATH: enhancedPath,
          TERM: 'xterm-256color',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
          GEMINI_API_KEY: process.env.GEMINI_API_KEY,
          XAI_API_KEY: process.env.XAI_API_KEY,
          GROK_API_KEY: process.env.GROK_API_KEY,
          KIMI_API_KEY: process.env.KIMI_API_KEY,
          OPENCODE_API_KEY: process.env.OPENCODE_API_KEY
        };

        try {
          terminal = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cols: message.cols || 80,
            rows: message.rows || 24,
            cwd: workspaceDir,
            env: termEnv
          });

          terminals.set(terminalId, terminal);

          terminal.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', data }));
            }
          });

          terminal.onExit(({ exitCode }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'exit', code: exitCode, cli: currentCli }));
            }
            terminals.delete(terminalId);
            terminal = null;
          });

          ws.send(JSON.stringify({
            type: 'launched',
            terminalId,
            cli: cliId,
            name: cli.name
          }));

        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            error: `Failed to launch ${cli.name}: ${err.message}`
          }));
        }
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
}, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`\nAvailable CLIs: ${Object.keys(CLI_TOOLS).join(', ')}`);
  console.log(`Workspace: ${workspaceDir}`);
});
