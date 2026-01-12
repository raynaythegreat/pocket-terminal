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
// CLIs handle their own authentication - user signs in through each CLI
const CLI_TOOLS = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    description: 'Sign in with your Anthropic account'
  },
  gemini: {
    name: 'Gemini CLI',
    command: 'gemini',
    description: 'Sign in with your Google account'
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    description: 'Sign in with your OpenAI account'
  },
  grok: {
    name: 'Grok',
    command: 'grok',
    description: 'Sign in with your xAI account'
  },
  kimi: {
    name: 'Kimi K2',
    command: 'kimi',
    description: 'Sign in with your Moonshot account'
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    description: 'Open source AI coding assistant'
  },
  bash: {
    name: 'Bash Shell',
    command: 'bash',
    description: 'Standard terminal for any command'
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
    description: cli.description
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

        // Launch CLI through bash for better error handling
        let shell = 'bash';
        let args;
        if (cliId === 'bash') {
          args = [];  // Interactive bash
        } else {
          args = ['-c', cli.command];  // Run CLI command through bash
        }

        // Build environment - CLIs handle their own authentication
        // Keep original HOME so CLIs can store auth tokens properly
        const homeDir = process.env.HOME || '/tmp';
        const termEnv = {
          ...process.env,
          PATH: enhancedPath,
          TERM: 'xterm-256color',
          HOME: homeDir,
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          XDG_DATA_HOME: path.join(homeDir, '.local/share')
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
