let socket;
let term;
let fitAddon;
let authToken = null;
let currentProjectId = null;
let ctrlPressed = false;

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
    // Attempt auto-reconnect if we were already authenticated
    if (authToken) {
      setTimeout(() => connect(authToken), 2000);
    }
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

document.querySelectorAll('.cli-card').forEach(card => {
  card.onclick = () => {
    startTerminal(card.dataset.cmd, card.dataset.args ? [card.dataset.args] : []);
  };
});

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
    else alert('Clone failed.');
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
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });

    window.addEventListener('resize', () => {
      fitAddon.fit();
      socket.send(JSON.stringify({ 
        type: 'resize', cols: term.cols, rows: term.rows 
      }));
    });
  }

  // Brief delay to ensure container is rendered before fit
  setTimeout(() => {
    fitAddon.fit();
    socket.send(JSON.stringify({
      type: 'spawn',
      command,
      args,
      projectId: currentProjectId,
      cols: term.cols,
      rows: term.rows
    }));
  }, 100);
}

function exitTerminal() {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
  if (term) term.clear();
}

document.getElementById('back-btn').onclick = () => {
  terminalScreen.classList.add('hidden');
  launcherScreen.classList.remove('hidden');
};

document.getElementById('clear-btn').onclick = () => term && term.clear();

// Mobile Helper Bar Logic
document.querySelectorAll('.helper-btn').forEach(btn => {
  btn.onclick = (e) => {
    const key = btn.dataset.key;
    if (!term) return;

    switch(key) {
      case 'tab': term.write('\t'); socket.send(JSON.stringify({type:'input', data:'\t'})); break;
      case 'esc': term.write('\x1b'); socket.send(JSON.stringify({type:'input', data:'\x1b'})); break;
      case 'ctrl': 
        ctrlPressed = !ctrlPressed;
        btn.style.background = ctrlPressed ? 'var(--accent)' : '';
        break;
      case 'up': socket.send(JSON.stringify({type:'input', data:'\x1b[A'})); break;
      case 'down': socket.send(JSON.stringify({type:'input', data:'\x1b[B'})); break;
      case 'left': socket.send(JSON.stringify({type:'input', data:'\x1b[D'})); break;
      case 'right': socket.send(JSON.stringify({type:'input', data:'\x1b[C'})); break;
      case 'ctrl-c': socket.send(JSON.stringify({type:'input', data:'\x03'})); break;
    }
  };
});