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

// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.static('public'));
app.use(express.json());

// Auth Middleware
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader === PASSWORD) next();
  else res.status(401).send('Unauthorized');
};

// Project Management APIs
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

  if (fs.existsSync(targetPath)) {
    return res.status(400).send('Project already exists');
  }

  exec(`git clone ${url}`, { cwd: PROJECTS_DIR }, (error) => {
    if (error) return res.status(500).send(error.message);
    res.json({ name: repoName });
  });
});

app.post('/api/projects/new', auth, (req, res) => {
  const { name } = req.body;
  const targetPath = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(targetPath)) return res.status(400).send('Exists');
  
  fs.mkdirSync(targetPath);
  res.json({ name });
});

wss.on('connection', (ws) => {
  let ptyProcess = null;

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
      const { command, args, projectId } = data;
      // Start in specific project folder or root projects dir
      const cwd = projectId ? path.join(PROJECTS_DIR, projectId) : PROJECTS_DIR;

      // Kill existing process if any
      if (ptyProcess) ptyProcess.kill();

      ptyProcess = pty.spawn(command || 'bash', args || [], {
        name: 'xterm-256color',
        cols: data.cols || 80,
        rows: data.rows || 24,
        cwd: cwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });

      ptyProcess.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'data', data }));
      });

      ptyProcess.on('exit', () => {
        ws.send(JSON.stringify({ type: 'exit' }));
        ptyProcess = null;
      });
    }

    if (data.type === 'data' && ptyProcess) {
      ptyProcess.write(data.data);
    }

    if (data.type === 'resize' && ptyProcess) {
      ptyProcess.resize(data.cols, data.rows);
    }
  });

  ws.on('close', () => {
    if (ptyProcess) ptyProcess.kill();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});