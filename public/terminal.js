let socket;
let term;
let fitAddon;
let currentProjectId = null;
let authToken = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const launcherScreen = document.getElementById('launcher-screen');
const terminalScreen = document.getElementById('terminal-screen');
const projectSelect = document.getElementById('project-select');

// Auth Setup
document.getElementById('login-form').onsubmit = (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  connect(password);
};

function connect(password) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'auth', password }));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'authenticated') {
      authToken = password;
      loginScreen.classList.add('hidden');
      launcherScreen.classList.remove('hidden');
      loadProjects();
    } else if (data.type === 'error') {
      document.getElementById('login-error').innerText = data.message;
    } else if (data.type === 'data') {
      term.write(data.data);
    } else if (data.type === 'exit') {
      exitTerminal();
    }
  };
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': authToken }
    });
    const projects = await res.json();
    projectSelect.innerHTML = '<option value="">(Root Directory)</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      projectSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load projects', err);
  }
}

// Project Actions
document.getElementById('clone-repo-btn').onclick = async () => {
  const url = prompt('Enter GitHub Repository URL:');
  if (!url) return;
  
  try {
    await fetch('/api/projects/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
      body: JSON.stringify({ url })
    });
    loadProjects();
  } catch (err) {
    alert('Failed to clone repository');
  }
};

document.getElementById('new-project-btn').onclick = async () => {
  const name = prompt('Project name:');
  if (!name) return;
  
  try {
    await fetch('/api/projects/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
      body: JSON.stringify({ name })
    });
    loadProjects();
  } catch (err) {
    alert('Failed to create project');
  }
};

// Launcher Logic
document.querySelectorAll('.cli-card').forEach(btn => {
  btn.onclick = () => {
    const cmd = btn.dataset.cmd;
    const args = btn.dataset.args ? btn.dataset.args.split(',') : [];
    const projectId = projectSelect.value;
    startTerminal(cmd, args, projectId);
  };
});

function startTerminal(command, args, projectId) {
  launcherScreen.classList.add('hidden');
  terminalScreen.classList.remove('hidden');
  
  if (!term) {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#000000' }
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    
    term.onData(data => {
      socket.send(JSON.stringify({ type: 'data', data }));
    });

    window.onresize = () => fitAddon.fit();
  }

  term.clear();
  fitAddon.fit();
  
  socket.send(JSON.stringify({
    type: 'spawn',
    command,
    args,
    projectId,
    cols: term.cols,
    rows: term.rows
  }));
}

function exitTerminal() {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
}

document.getElementById('back-to-launcher').onclick = () => {
  // In a real terminal we'd send Ctrl+C or kill the process
  // For now we just hide the UI; the server kills the PTY on socket close or next spawn
  exitTerminal();
};

// Helper Keys
document.querySelectorAll('.key-btn').forEach(btn => {
  btn.onclick = () => {
    const key = btn.dataset.key;
    let code = '';
    
    if (key === 'Tab') code = '\t';
    else if (key === 'Escape') code = '\x1b';
    else if (key === 'Control') return; // Needs multi-key handling, simplified for now
    else if (key === 'ArrowUp') code = '\x1b[A';
    else if (key === 'ArrowDown') code = '\x1b[B';
    else if (key === 'ArrowLeft') code = '\x1b[D';
    else if (key === 'ArrowRight') code = '\x1b[C';
    
    socket.send(JSON.stringify({ type: 'data', data: code }));
    term.focus();
  };
});

// Theme Toggle
document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
  btn.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
  };
});