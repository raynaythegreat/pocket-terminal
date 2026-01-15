const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// Use .trim() to ensure no accidental spaces in environment variables
const PASSWORD = (process.env.PASSWORD || 'pocket').trim();
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Global store for terminal sessions: sessionId -> { term, lastActive }
const sessions = new Map();

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static('public'));
app.use(express.json());

// Auth middleware for REST API
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (token && token.trim() === PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// API: List Projects
app.get('/api/projects', authMiddleware, (req, res) => {
  try {
    const folders = fs.readdirSync(PROJECTS_DIR).filter(file => 
      fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory()
    );
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Clone Repository with Token Support
app.post('/api/projects/clone', authMiddleware, (req, res) => {
  const { url, token } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Handle Private Repos by injecting token if provided
  let cloneUrl = url;
  if (token && url.startsWith('https://github.com/')) {
    cloneUrl = url.replace('https://github.com/', `https://${token}@github.com/`);
  }

  const repoName = url.split('/').pop().replace('.git', '');
  const targetPath = path.join(PROJECTS_DIR, repoName);
  
  if (fs.existsSync(targetPath)) {
    return res.status(400).json({ error: 'Project already exists' });
  }

  exec(`git clone ${cloneUrl} ${repoName}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).json({ error: error.message });
    res.json({ name: repoName });
  });
});

wss.on('connection', (ws) => {
  let authenticated = false;
  let sessionKey = null;

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) { return; }

    // 1. Mandatory Auth
    if (msg.type === 'auth') {
      if (msg.password && msg.password.trim() === PASSWORD) {
        authenticated = true;
        ws.send(JSON.stringify({ type: 'authenticated' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid Password' }));
      }
      return;
    }

    if (!authenticated) return;

    // 2. Terminal Lifecycle
    if (msg.type === 'spawn') {
      const { command, args = [], projectId, cols = 80, rows = 24 } = msg;
      sessionKey = `${projectId || 'root'}-${command}`;
      const cwd = projectId ? path.join(PROJECTS_DIR, projectId) : __dirname;

      let session = sessions.get(sessionKey);

      // If session doesn't exist or process died, create new one
      if (!session || !session.term) {
        const term = pty.spawn(command, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        });

        session = { term, ws: new Set() };
        
        term.onData((data) => {
          session.ws.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'data', data }));
            }
          });
        });

        term.onExit(() => {
          session.ws.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'exit' }));
            }
          });
          sessions.delete(sessionKey);
        });

        sessions.set(sessionKey, session);
      }

      // Attach this connection to the session
      session.ws.add(ws);
      
      // Trigger a resize to current client dimensions
      session.term.resize(cols, rows);
      
      // Send a clear/refresh hint (optional)
      ws.send(JSON.stringify({ type: 'data', data: '\r\n--- Reconnected to Session ---\r\n' }));
    }

    if (msg.type === 'input' && sessionKey) {
      const session = sessions.get(sessionKey);
      if (session && session.term) {
        session.term.write(msg.data);
      }
    }

    if (msg.type === 'resize' && sessionKey) {
      const session = sessions.get(sessionKey);
      if (session && session.term) {
        session.term.resize(msg.cols, msg.rows);
      }
    }
  });

  ws.on('close', () => {
    if (sessionKey) {
      const session = sessions.get(sessionKey);
      if (session) session.ws.delete(ws);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Terminal running on http://localhost:${PORT}`);
  console.log(`Auth Password configured: ${PASSWORD ? 'YES' : 'NO (Using default: pocket)'}`);
});