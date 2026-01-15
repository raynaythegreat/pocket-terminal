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

function init() {
  const savedPass = sessionStorage.getItem('pocket_pass');
  if (savedPass) connect(savedPass);
}

document.getElementById('login-form').onsubmit = (e) => {
  e.preventDefault();
  connect(document.getElementById('password').value);
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
      closeTerminal();
    }
  };

  socket.onclose = () => {
    document.getElementById('connection-status').innerText = 'Offline';
    document.getElementById('connection-status').style.color = 'var(--error)';
    if (authToken) setTimeout(() => connect(authToken), 3000);
  };
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', { headers: { 'Authorization': authToken } });
    const projects = await res.json();
    projectSelect.innerHTML = '<option value="">Root Workspace</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      projectSelect.appendChild(opt);
    });
  } catch (err) { console.error('Load projects failed'); }
}

function launchCLI(cmd, args = []) {
  launcherScreen.classList.add('hidden');
  terminalScreen.classList.remove('hidden');

  if (!term) {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff'
      }
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    
    term.onData(data => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });
    
    window.addEventListener('resize', () => fitAddon.fit());
  }

  term.clear();
  setTimeout(() => {
    fitAddon.fit();
    socket.send(JSON.stringify({
      type: 'spawn',
      command: cmd,
      args: Array.isArray(args) ? args : [args],
      projectId: currentProjectId,
      cols: term.cols,
      rows: term.rows
    }));
  }, 100);
}

function closeTerminal() {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
}

// Mobile Helper Keys
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.onclick = () => {
    const key = btn.getAttribute('data-key');
    if (key === 'CTRL') {
      ctrlActive = !ctrlActive;
      btn.style.background = ctrlActive ? 'var(--accent)' : '';
      return;
    }
    
    let input = '';
    if (key === 'TAB') input = '\t';
    if (key === 'ESC') input = '\x1b';
    if (key === 'UP') input = '\x1b[A';
    if (key === 'DOWN') input = '\x1b[B';
    
    if (ctrlActive) {
      // If CTRL is active, convert key to control char
      input = String.fromCharCode(key.charCodeAt(0) - 64);
      ctrlActive = false;
      document.querySelector('[data-key="CTRL"]').style.background = '';
    }

    socket.send(JSON.stringify({ type: 'input', data: input }));
    term.focus();
  };
});

document.querySelectorAll('.cli-card').forEach(card => {
  card.onclick = () => launchCLI(card.dataset.cmd, card.dataset.args ? card.dataset.args.split(' ') : []);
});

projectSelect.onchange = (e) => {
  currentProjectId = e.target.value;
  ctxLabel.innerText = currentProjectId || 'Root';
};

document.getElementById('logout-btn').onclick = () => {
  sessionStorage.removeItem('pocket_pass');
  location.reload();
};

init();