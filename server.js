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

// Cleanup stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastUsed > 30 * 60 * 1000) {
      console.log(`Cleaning up stale session: ${id}`);
      session.process.kill();
      sessions.delete(id);
    }
  }
}, 60000);

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static('public'));
app.use(express.json());

// Auth Middleware for API
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader === PASSWORD) next();
  else res.status(401).send('Unauthorized');
};

// API: List Projects
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

// API: Clone Repo
app.post('/api/projects/clone', auth, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send('URL required');
  const repoName = url.split('/').pop().replace('.git', '');
  const targetPath = path.join(PROJECTS_DIR, repoName);

  if (fs.existsSync(targetPath)) return res.status(400).send('Project already exists');

  exec(`git clone ${url}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).send(error.message);
    res.json({ name: repoName });
  });
});

wss.on('connection', (ws) => {
  let currentSessionId = null;
  let authenticated = false;

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    // 1. Authenticate first
    if (data.type === 'auth') {
      if (data.password === PASSWORD) {
        authenticated = true;
        ws.send(JSON.stringify({ type: 'authenticated' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid password' }));
      }
      return;
    }

    if (!authenticated) return;

    // 2. Handle Terminal Spawning / Reattaching
    if (data.type === 'spawn') {
      const { command, args, projectId, cols, rows } = data;
      // Session ID is unique to the Command + Project
      const sessionId = `${projectId || 'root'}-${command}`;
      currentSessionId = sessionId;

      let session = sessions.get(sessionId);

      if (!session) {
        const cwd = projectId ? path.join(PROJECTS_DIR, projectId) : PROJECTS_DIR;
        const ptyProcess = pty.spawn(command || 'bash', args || [], {
          name: 'xterm-256color',
          cols: cols || 80,
          rows: rows || 24,
          cwd: cwd,
          env: { ...process.env, TERM: 'xterm-256color' }
        });

        session = { process: ptyProcess, lastUsed: Date.now() };
        sessions.set(sessionId, session);

        ptyProcess.on('data', (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data }));
          }
        });

        ptyProcess.on('exit', () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'exit' }));
          }
          sessions.delete(sessionId);
        });
      } else {
        // Session exists, update activity and send current buffer hint
        session.lastUsed = Date.now();
        // Re-request full screen redraw from terminal apps
        session.process.write('\x0c'); // Send Form Feed / Clear to force redraw
      }

      // Re-send current session ID to client
      ws.send(JSON.stringify({ type: 'ready', sessionId }));
      return;
    }

    // 3. Handle Input
    if (data.type === 'input' && currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        session.lastUsed = Date.now();
        session.process.write(data.data);
      }
    }

    // 4. Handle Resize
    if (data.type === 'resize' && currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        session.process.resize(data.cols, data.rows);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Terminal running at http://localhost:${PORT}`);
});