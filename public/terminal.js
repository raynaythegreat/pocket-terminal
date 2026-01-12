(function() {
  // DOM Elements
  const loginScreen = document.getElementById('login-screen');
  const launcherScreen = document.getElementById('launcher-screen');
  const terminalScreen = document.getElementById('terminal-screen');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const cliGrid = document.getElementById('cli-grid');
  const terminalContainer = document.getElementById('terminal-container');
  const currentCliLabel = document.getElementById('current-cli');
  const exitBtn = document.getElementById('exit-btn');
  const switchBtn = document.getElementById('switch-btn');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const toolbar = document.getElementById('mobile-toolbar');

  // CLI Icons
  const CLI_ICONS = {
    claude: '🤖',
    gemini: '✨',
    codex: '💻',
    grok: '🧠',
    github: '🐙',
    bash: '⌨️'
  };

  // State
  let token = localStorage.getItem('terminal_token');
  let ws = null;
  let term = null;
  let fitAddon = null;
  let currentCli = null;
  let cliList = [];

  function setStatus(status, text) {
    statusEl.className = status;
    statusText.textContent = text;
    statusEl.classList.remove('hidden');
  }

  function showScreen(screen) {
    loginScreen.classList.add('hidden');
    launcherScreen.classList.add('hidden');
    terminalScreen.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  async function fetchCLIs() {
    try {
      const response = await fetch('/api/clis');
      cliList = await response.json();
      renderCLIGrid();
    } catch (err) {
      console.error('Failed to fetch CLIs:', err);
    }
  }

  function renderCLIGrid() {
    cliGrid.innerHTML = cliList.map(cli => `
      <div class="cli-card" data-cli="${cli.id}">
        <div class="cli-icon">${CLI_ICONS[cli.id] || '🔧'}</div>
        <div class="cli-name">${cli.name}</div>
        <div class="cli-desc">${cli.description}</div>
      </div>
    `).join('');

    cliGrid.querySelectorAll('.cli-card').forEach(card => {
      card.addEventListener('click', () => {
        const cliId = card.dataset.cli;
        const cli = cliList.find(c => c.id === cliId);
        if (cli) {
          launchCLI(cliId, cli.name);
        }
      });
    });
  }

  function initTerminal() {
    if (term) {
      term.dispose();
    }

    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0f0f1a',
        foreground: '#e0e0e0',
        cursor: '#00d9ff',
        cursorAccent: '#0f0f1a',
        selection: 'rgba(0, 217, 255, 0.3)',
        black: '#1a1a2e',
        red: '#ff6b6b',
        green: '#00d964',
        yellow: '#ffc107',
        blue: '#00d9ff',
        magenta: '#c792ea',
        cyan: '#89ddff',
        white: '#e0e0e0',
        brightBlack: '#444',
        brightRed: '#ff8a8a',
        brightGreen: '#4ade80',
        brightYellow: '#ffd43b',
        brightBlue: '#60e1ff',
        brightMagenta: '#ddb6f2',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff'
      },
      scrollback: 10000
    });

    fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalContainer);

    term.onData(data => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    window.addEventListener('resize', handleResize);
    terminalContainer.addEventListener('click', () => term.focus());
  }

  function handleResize() {
    if (fitAddon && term) {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }
    }
  }

  function connect() {
    if (!token) {
      showScreen(loginScreen);
      return;
    }

    setStatus('connecting', 'Connecting...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'authenticated':
            setStatus('connected', 'Connected');
            fetchCLIs();
            showScreen(launcherScreen);
            break;

          case 'launched':
            currentCli = message.cli;
            currentCliLabel.textContent = message.name;
            showScreen(terminalScreen);
            initTerminal();
            setTimeout(() => {
              fitAddon.fit();
              term.focus();
            }, 100);
            break;

          case 'output':
            if (term) {
              term.write(message.data);
            }
            break;

          case 'exit':
            if (term) {
              term.writeln('\r\n\x1b[33m[CLI exited - tap Exit to return]\x1b[0m');
            }
            break;

          case 'killed':
            // Terminal was killed, ready for next action
            break;

          case 'error':
            if (message.error.includes('Invalid') || message.error.includes('expired')) {
              localStorage.removeItem('terminal_token');
              token = null;
              showScreen(loginScreen);
              loginError.textContent = 'Session expired. Please log in again.';
            } else {
              console.error('Error:', message.error);
              if (term) {
                term.writeln('\r\n\x1b[31m[Error: ' + message.error + ']\x1b[0m');
              }
            }
            break;
        }
      } catch (err) {
        console.error('Message parse error:', err);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected', 'Disconnected');
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  function killCurrentTerminal() {
    return new Promise((resolve) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const handler = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'killed') {
              ws.removeEventListener('message', handler);
              resolve();
            }
          } catch (e) {}
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ type: 'kill' }));
        // Timeout fallback
        setTimeout(() => {
          ws.removeEventListener('message', handler);
          resolve();
        }, 1000);
      } else {
        resolve();
      }
    });
  }

  async function launchCLI(cliId, cliName) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Kill existing terminal first
      await killCurrentTerminal();

      // Clear terminal display
      if (term) {
        term.clear();
      }

      ws.send(JSON.stringify({
        type: 'launch',
        cli: cliId,
        cols: term ? term.cols : 80,
        rows: term ? term.rows : 24
      }));
    }
  }

  // Login form handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const password = passwordInput.value;

    try {
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (data.success) {
        token = data.token;
        localStorage.setItem('terminal_token', token);
        passwordInput.value = '';
        connect();
      } else {
        loginError.textContent = data.error || 'Authentication failed';
        passwordInput.select();
      }
    } catch (err) {
      loginError.textContent = 'Connection error. Please try again.';
    }
  });

  // Exit button - kill terminal and go back to launcher
  exitBtn.addEventListener('click', async () => {
    await killCurrentTerminal();
    if (term) {
      term.clear();
    }
    showScreen(launcherScreen);
  });

  // Switch button - kill terminal and go back to launcher
  switchBtn.addEventListener('click', async () => {
    await killCurrentTerminal();
    if (term) {
      term.clear();
    }
    showScreen(launcherScreen);
  });

  // Mobile toolbar buttons
  toolbar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !ws || ws.readyState !== WebSocket.OPEN) return;

    const key = button.dataset.key;
    const ctrl = button.dataset.ctrl;

    if (term) {
      if (key === 'Escape') {
        ws.send(JSON.stringify({ type: 'input', data: '\x1b' }));
      } else if (key === 'Tab') {
        ws.send(JSON.stringify({ type: 'input', data: '\t' }));
      } else if (key === 'ArrowUp') {
        ws.send(JSON.stringify({ type: 'input', data: '\x1b[A' }));
      } else if (key === 'ArrowDown') {
        ws.send(JSON.stringify({ type: 'input', data: '\x1b[B' }));
      } else if (ctrl) {
        const charCode = ctrl.toUpperCase().charCodeAt(0) - 64;
        ws.send(JSON.stringify({ type: 'input', data: String.fromCharCode(charCode) }));
      }
      term.focus();
    }
  });

  // Initialize
  if (token) {
    connect();
  } else {
    showScreen(loginScreen);
  }
})();
