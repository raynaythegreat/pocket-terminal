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
const PASSWORD = process.env.PASSWORD || 'pocket';
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Session Store: Maps sessionId -> { process, lastUsed }
const sessions = new Map();

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static('public'));
app.use(express.json());

// Auth Middleware for API
const auth = (req, res, next) => {
  if (req.headers.authorization === PASSWORD) next();
  else res.status(401).send('Unauthorized');
};

app.get('/api/projects', auth, (req, res) => {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR).filter(file => 
      fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory()
    );
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/clone', auth, (req, res) => {
  const { url } = req.body;
  const repoName = url.split('/').pop().replace('.git', '');
  const targetPath = path.join(PROJECTS_DIR, repoName);
  
  if (fs.existsSync(targetPath)) return res.status(400).send('Exists');

  exec(`git clone ${url}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).send(error.message);
    res.json({ name: repoName });
  });
});

wss.on('connection', (ws) => {
  let authenticated = false;
  let currentPty = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) { return; }

    // 1. Mandatory Auth First
    if (data.type === 'auth') {
      if (data.password === PASSWORD) {
        authenticated = true;
        ws.send(JSON.stringify({ type: 'authenticated' }));
        console.log('Client authenticated successfully');
      } else {
        console.log('Auth failed: invalid password');
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid password' }));
      }
      return;
    }

    if (!authenticated) return;

    // 2. Spawn or Reattach Terminal
    if (data.type === 'spawn') {
      const { command, args = [], projectId, cols = 80, rows = 24 } = data;
      const sessionId = `${projectId || 'root'}-${command}`;
      const cwd = projectId ? path.join(PROJECTS_DIR, projectId) : __dirname;

      let session = sessions.get(sessionId);

      if (!session) {
        console.log(`Spawning new session: ${sessionId}`);
        const term = pty.spawn(command, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color' }
        });

        session = { term, listeners: new Set() };
        
        term.onData((data) => {
          const msg = JSON.stringify({ type: 'data', data });
          session.listeners.forEach(l => l.send(msg));
        });

        term.onExit(() => {
          session.listeners.forEach(l => l.send(JSON.stringify({ type: 'exit' })));
          sessions.delete(sessionId);
        });

        sessions.set(sessionId, session);
      }

      currentPty = session.term;
      session.listeners.add(ws);
      
      // Send current state to new listener
      ws.send(JSON.stringify({ type: 'data', data: '\r\n\x1b[32m-- Reattached to session --\x1b[0m\r\n' }));
    }

    // 3. Handle Input
    if (data.type === 'input' && currentPty) {
      currentPty.write(data.data);
    }

    // 4. Handle Resize
    if (data.type === 'resize' && currentPty) {
      currentPty.resize(data.cols, data.rows);
    }
  });

  ws.on('close', () => {
    for (const session of sessions.values()) {
      session.listeners.delete(ws);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Auth Password set to: ${PASSWORD}`);
});