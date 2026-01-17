const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(__dirname, 'workspace', 'projects');
const CLI_HOME_DIR = process.env.CLI_HOME_DIR || path.join(__dirname, 'workspace', 'cli-home');

// Ensure directories exist
[WORKSPACE_DIR, CLI_HOME_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Simple session store
const sessions = new Set();

// Tool definitions
const TOOLS = [
  { id: 'shell', name: 'Terminal', cmd: 'bash', category: 'core', icon: 'terminal' },
  { id: 'claude', name: 'Claude Code', cmd: 'claude', category: 'ai', icon: 'brain' },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', category: 'ai', icon: 'sparkles' },
  { id: 'copilot', name: 'Copilot', cmd: 'github-copilot', category: 'ai', icon: 'github' },
  { id: 'opencode', name: 'OpenCode', cmd: './opencode', category: 'core', icon: 'code' },
  { id: 'kimi', name: 'Kimi', cmd: './kimi', category: 'ai', icon: 'message-square' }
];

// Helper to check if a command exists
function checkCommand(cmd) {
  try {
    if (cmd.startsWith('./')) {
      return fs.existsSync(path.join(__dirname, cmd));
    }
    // Check local node_modules
    const localBin = path.join(__dirname, 'node_modules', '.bin', cmd);
    if (fs.existsSync(localBin)) return true;
    
    // Check system path
    const which = os.platform() === 'win32' ? 'where' : 'which';
    require('child_process').execSync(`${which} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

app.get('/api/tools', (req, res) => {
  const availableTools = TOOLS.map(tool => ({
    ...tool,
    ready: checkCommand(tool.cmd)
  }));
  res.json(availableTools);
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (auth.verifyPassword(password)) {
    const token = Math.random().toString(36).substring(2);
    sessions.add(token);
    res.cookie('session_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid password' });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const toolId = url.searchParams.get('tool') || 'shell';
  const tool = TOOLS.find(t => t.id === toolId) || TOOLS[0];

  // Tool-specific home directory to persist config/auth
  const toolHome = path.join(CLI_HOME_DIR, 'tools', toolId);
  if (!fs.existsSync(toolHome)) fs.mkdirSync(toolHome, { recursive: true });

  // Prepare environment: Inject node_modules/.bin into PATH
  const localBin = path.join(__dirname, 'node_modules', '.bin');
  const env = { 
    ...process.env, 
    HOME: toolHome,
    PATH: `${localBin}${path.delimiter}${process.env.PATH}`,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  };

  const shell = tool.cmd.startsWith('./') ? path.join(__dirname, tool.cmd) : tool.cmd;
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: WORKSPACE_DIR,
    env: env
  });

  ptyProcess.onData(data => {
    if (ws.readyState === 1) ws.send(data);
  });

  ws.on('message', message => {
    const msg = JSON.parse(message);
    if (msg.type === 'input') ptyProcess.write(msg.data);
    if (msg.type === 'resize') ptyProcess.resize(msg.cols, msg.rows);
  });

  ws.on('close', () => ptyProcess.kill());
});

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
});