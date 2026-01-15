let socket;
let term;
let fitAddon;
let authToken = null;
let currentProjectId = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const launcherScreen = document.getElementById('launcher-screen');
const terminalScreen = document.getElementById('terminal-screen');
const projectSelect = document.getElementById('project-select');
const ctxLabel = document.getElementById('current-ctx');

// Auth Logic
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
      if (socket) socket.close();
    } else if (data.type === 'data') {
      if (term) term.write(data.data);
    } else if (data.type === 'exit') {
      exitTerminal();
    }
  };

  socket.onclose = () => {
    document.getElementById('connection-status').innerText = 'Disconnected';
    document.getElementById('connection-status').style.color = 'red';
  };
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': authToken }
    });
    const projects = await res.json();
    
    projectSelect.innerHTML = '<option value="">(Root Projects Folder)</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      projectSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load projects');
  }
}

// Project Actions
projectSelect.onchange = (e) => {
  currentProjectId = e.target.value;
  ctxLabel.innerText = currentProjectId || 'Root';
};

document.getElementById('clone-repo-btn').onclick = async () => {
  const url = prompt('GitHub Repository URL:');
  if (!url) return;
  
  try {
    const res = await fetch('/api/projects/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
      body: JSON.stringify({ url })
    });
    if (res.ok) loadProjects();
    else alert('Clone failed. Check server logs.');
  } catch (err) {
    alert('Request failed');
  }
};

// Terminal Lifecycle
function startTerminal(command, args = []) {
  launcherScreen.classList.add('hidden');
  terminalScreen.classList.remove('hidden');
  document.getElementById('term-title').innerText = command;

  if (!term) {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#000000' },
      allowProposedApi: true
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    
    term.onData(data => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'data', data }));
      }
    });

    window.addEventListener('resize', () => fitAddon.fit());
  } else {
    term.clear();
  }

  fitAddon.fit();

  socket.send(JSON.stringify({
    type: 'spawn',
    command,
    args,
    projectId: currentProjectId,
    cols: term.cols,
    rows: term.rows
  }));
}

function exitTerminal() {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
}

document.getElementById('back-to-launcher').onclick = () => {
  // We don't kill the process immediately to allow background tasks, 
  // but for this UI we return to dashboard.
  exitTerminal();
};

document.getElementById('clear-term').onclick = () => term.clear();

// CLI Card Click Handlers
document.querySelectorAll('.cli-card').forEach(card => {
  card.onclick = () => {
    const cmd = card.dataset.cmd;
    const args = card.dataset.args ? card.dataset.args.split(',') : [];
    startTerminal(cmd, args);
  };
});

// Mobile Helper Keys
document.querySelectorAll('.helper-key').forEach(btn => {
  btn.onclick = (e) => {
    e.preventDefault();
    const key = btn.dataset.key;
    
    let sequence = key;
    if (key === 'Control') sequence = '\x03'; // Map CTRL to Ctrl+C for now, or handle modifier state
    if (key === 'Tab') sequence = '\t';
    if (key === 'Escape') sequence = '\x1b';
    if (key === 'ArrowUp') sequence = '\x1b[A';
    if (key === 'ArrowDown') sequence = '\x1b[B';
    if (key === 'ArrowLeft') sequence = '\x1b[D';
    if (key === 'ArrowRight') sequence = '\x1b[C';

    socket.send(JSON.stringify({ type: 'data', data: sequence }));
    term.focus();
  };
});

document.getElementById('logout-btn').onclick = () => location.reload();