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

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader === PASSWORD) next();
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
  if (!url) return res.status(400).send('URL required');
  const repoName = url.split('/').pop().replace('.git', '');
  const targetPath = path.join(PROJECTS_DIR, repoName);

  if (fs.existsSync(targetPath)) return res.status(400).send('Exists');

  exec(`git clone ${url}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).send(error.message);
    res.json({ name: repoName });
  });
});

wss.on('connection', (ws) => {
  let currentSessionId = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'auth') {
      if (data.password === PASSWORD) {
        ws.send(JSON.stringify({ type: 'authenticated' }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid password' }));
      }
    }

    if (data.type === 'spawn') {
      const { command, args, projectId, cols, rows } = data;
      // Unique session key based on project and command
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
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        });

        session = { process: ptyProcess, lastUsed: Date.now() };
        sessions.set(sessionId, session);

        ptyProcess.on('data', (chunk) => {
          // Broadcast to all clients watching this session
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.sessionId === sessionId) {
              client.send(JSON.stringify({ type: 'data', data: chunk }));
            }
          });
        });

        ptyProcess.on('exit', () => {
          wss.clients.forEach(client => {
            if (client.sessionId === sessionId) {
              client.send(JSON.stringify({ type: 'exit' }));
            }
          });
          sessions.delete(sessionId);
        });
      }

      ws.sessionId = sessionId;
      session.lastUsed = Date.now();
      
      // Send current state/confirm attachment
      ws.send(JSON.stringify({ type: 'attached', sessionId }));
    }

    if (data.type === 'input') {
      const session = sessions.get(currentSessionId);
      if (session) {
        session.lastUsed = Date.now();
        session.process.write(data.data);
      }
    }

    if (data.type === 'resize') {
      const session = sessions.get(currentSessionId);
      if (session) {
        session.process.resize(data.cols, data.rows);
      }
    }
  });

  ws.on('close', () => {
    // We don't kill the process, allowing re-attachment
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});