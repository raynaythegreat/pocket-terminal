let socket;
let term;
let fitAddon;
let authToken = null;
let currentProjectId = null;
let ctrlActive = false;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const launcherScreen = document.getElementById('launcher-screen');
const terminalScreen = document.getElementById('terminal-screen');
const projectSelect = document.getElementById('project-select');
const ctxLabel = document.getElementById('current-ctx');

// Initialize App
function init() {
  const savedPass = sessionStorage.getItem('pocket_pass');
  if (savedPass) connect(savedPass);
}

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
      sessionStorage.setItem('pocket_pass', password);
      loginScreen.classList.add('hidden');
      launcherScreen.classList.remove('hidden');
      loadProjects();
    } else if (data.type === 'error') {
      document.getElementById('login-error').innerText = data.message;
      sessionStorage.removeItem('pocket_pass');
    } else if (data.type === 'data') {
      if (term) term.write(data.data);
    } else if (data.type === 'exit') {
      exitTerminal();
    }
  };

  socket.onclose = () => {
    document.getElementById('connection-status').innerText = 'Disconnected';
    document.getElementById('connection-status').style.color = 'red';
    // Auto-reconnect
    if (authToken) setTimeout(() => connect(authToken), 2000);
  };
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': authToken }
    });
    const projects = await res.json();
    
    projectSelect.innerHTML = '<option value="">Root Workspace</option>';
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
  const url = prompt('GitHub Repo URL (HTTPS):');
  if (!url) return;
  
  try {
    const res = await fetch('/api/projects/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
      body: JSON.stringify({ url })
    });
    if (res.ok) {
      loadProjects();
      alert('Cloned successfully!');
    } else {
      const msg = await res.text();
      alert('Error: ' + msg);
    }
  } catch (err) { alert('Clone failed'); }
};

// Terminal Lifecycle
function startTerminal(cmd, args = []) {
  launcherScreen.classList.add('hidden');
  terminalScreen.classList.remove('hidden');
  document.getElementById('term-title').innerText = cmd.toUpperCase();

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
      socket.send(JSON.stringify({ type: 'input', data }));
    });
  }

  setTimeout(() => {
    fitAddon.fit();
    socket.send(JSON.stringify({
      type: 'spawn',
      command: cmd,
      args: args,
      projectId: currentProjectId,
      cols: term.cols,
      rows: term.rows
    }));
  }, 100);
}

function exitTerminal() {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
}

document.getElementById('back-to-launcher').onclick = () => {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
};

document.querySelectorAll('.cli-card').forEach(card => {
  card.onclick = () => {
    const args = card.dataset.args ? card.dataset.args.split(' ') : [];
    startTerminal(card.dataset.cmd, args);
  };
});

// Mobile Helper Keys
document.querySelectorAll('.helper-btn').forEach(btn => {
  btn.onclick = () => {
    const key = btn.dataset.key;
    if (key === 'ctrl') {
      ctrlActive = !ctrlActive;
      btn.classList.toggle('active', ctrlActive);
      return;
    }

    let sequence = '';
    switch(key) {
      case 'tab': sequence = '\t'; break;
      case 'esc': sequence = '\x1b'; break;
      case 'up': sequence = '\x1b[A'; break;
      case 'down': sequence = '\x1b[B'; break;
      case 'left': sequence = '\x1b[D'; break;
      case 'right': sequence = '\x1b[C'; break;
      case '/': sequence = '/'; break;
    }

    if (ctrlActive && key.length === 1) {
      // Handle Ctrl+Key combinations
      const code = key.toUpperCase().charCodeAt(0) - 64;
      sequence = String.fromCharCode(code);
      ctrlActive = false;
      document.querySelector('[data-key="ctrl"]').classList.remove('active');
    }

    socket.send(JSON.stringify({ type: 'input', data: sequence }));
    term.focus();
  };
});

window.onresize = () => {
  if (fitAddon) {
    fitAddon.fit();
    socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
};

init();