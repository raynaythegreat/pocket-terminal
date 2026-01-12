(function() {
  // DOM Elements
  const loginScreen = document.getElementById('login-screen');
  const launcherScreen = document.getElementById('launcher-screen');
  const terminalScreen = document.getElementById('terminal-screen');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const cliGrid = document.getElementById('cli-grid');
  const launcherError = document.getElementById('launcher-error');
  const retryBtn = document.getElementById('retry-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const terminalContainer = document.getElementById('terminal-container');
  const currentCliLabel = document.getElementById('current-cli');
  const exitBtn = document.getElementById('exit-btn');
  const switchBtn = document.getElementById('switch-btn');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const toolbar = document.getElementById('mobile-toolbar');

  // CLI Icons
  const CLI_ICONS = {
    opencode: '🛠️',
    kimi: '🌙',
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
  let reconnectAttempt = 0;
  let reconnectTimeoutId = null;
  let listenersAttached = false;
  let manuallyDisconnected = false;

  function setStatus(status, text) {
    statusEl.className = status;
    statusText.textContent = text;
    statusEl.classList.remove('hidden');
  }

  function setLauncherError(message) {
    if (!launcherError) return;

    if (!message) {
      launcherError.textContent = '';
      launcherError.classList.add('hidden');
      return;
    }

    launcherError.textContent = message;
    launcherError.classList.remove('hidden');
  }

  function setRetryVisible(visible) {
    if (!retryBtn) return;
    retryBtn.classList.toggle('hidden', !visible);
  }

  function showScreen(screen) {
    loginScreen.classList.add('hidden');
    launcherScreen.classList.add('hidden');
    terminalScreen.classList.add('hidden');
    screen.classList.remove('hidden');

    if (screen === loginScreen) {
      passwordInput.focus();
    }
  }

  async function fetchCLIs() {
    setLauncherError(null);
    setRetryVisible(false);
    cliGrid.innerHTML = '<div class="cli-loading">Loading tools…</div>';

    try {
      const response = await fetch('/api/clis');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      cliList = await response.json();
      renderCLIGrid();
    } catch (err) {
      console.error('Failed to fetch CLIs:', err);
      cliGrid.innerHTML = '';
      setLauncherError('Could not load CLI tools. Please retry.');
      setRetryVisible(true);
    }
  }

  function renderCLIGrid() {
    const normalized = Array.isArray(cliList) ? cliList : [];
    const sorted = [...normalized].sort((a, b) => {
      const aAvailable = a.available !== false;
      const bAvailable = b.available !== false;
      if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    cliGrid.innerHTML = sorted.map((cli) => {
      const available = cli.available !== false;
      return `
        <button class="cli-card${available ? '' : ' disabled'}" data-cli="${cli.id}" type="button" ${available ? '' : 'disabled'}>
          ${available ? '' : '<div class="cli-badge">Not installed</div>'}
          <div class="cli-icon">${CLI_ICONS[cli.id] || '🔧'}</div>
          <div class="cli-name">${cli.name}</div>
          <div class="cli-desc">${cli.description}</div>
        </button>
      `;
    }).join('');
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
        background: '#0b1020',
        foreground: '#e6e9f2',
        cursor: '#4f8cff',
        cursorAccent: '#0b1020',
        selection: 'rgba(79, 140, 255, 0.25)',
        black: '#0b1020',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#4f8cff',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#e6e9f2',
        brightBlack: '#444',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#7aa8ff',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
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

    if (!listenersAttached) {
      window.addEventListener('resize', handleResize);
      terminalContainer.addEventListener('click', () => term && term.focus());
      listenersAttached = true;
    }
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

  function scheduleReconnect() {
    if (!token || manuallyDisconnected) return;
    if (reconnectTimeoutId) return;

    reconnectAttempt += 1;
    const delay = Math.min(10000, 500 * (2 ** (reconnectAttempt - 1)));
    setStatus('connecting', `Reconnecting… (${reconnectAttempt})`);

    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null;
      connect();
    }, delay);
  }

  function connect() {
    if (!token) {
      showScreen(loginScreen);
      return;
    }

    manuallyDisconnected = false;
    setLauncherError(null);
    setRetryVisible(false);

    if (reconnectTimeoutId) {
      window.clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }

    if (ws) {
      const prev = ws;
      ws = null;
      prev.onopen = null;
      prev.onmessage = null;
      prev.onclose = null;
      prev.onerror = null;
      try {
        prev.close();
      } catch (e) {}
    }

    setStatus('connecting', 'Connecting...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      reconnectAttempt = 0;
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
              manuallyDisconnected = true;
              showScreen(loginScreen);
              loginError.textContent = 'Session expired. Please log in again.';
            } else {
              console.error('Error:', message.error);
              if (term) {
                term.writeln('\r\n\x1b[31m[Error: ' + message.error + ']\x1b[0m');
              } else {
                setLauncherError(message.error);
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
      ws = null;
      scheduleReconnect();
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
    setLauncherError(null);
    setRetryVisible(false);

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
    fetchCLIs();
  });

  // Switch button - kill terminal and go back to launcher
  switchBtn.addEventListener('click', async () => {
    await killCurrentTerminal();
    if (term) {
      term.clear();
    }
    showScreen(launcherScreen);
    fetchCLIs();
  });

  if (cliGrid) {
    cliGrid.addEventListener('click', (e) => {
      const button = e.target.closest('.cli-card');
      if (!button || button.disabled) return;
      const cliId = button.dataset.cli;
      const cli = cliList.find(c => c.id === cliId);
      if (cli) {
        launchCLI(cliId, cli.name);
      }
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      fetchCLIs();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      manuallyDisconnected = true;
      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
      await killCurrentTerminal();
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
        ws = null;
      }
      localStorage.removeItem('terminal_token');
      token = null;
      currentCli = null;
      setLauncherError(null);
      setRetryVisible(false);
      showScreen(loginScreen);
    });
  }

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
