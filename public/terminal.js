(function() {
  // DOM Elements
  const loginScreen = document.getElementById('login-screen');
  const terminalScreen = document.getElementById('terminal-screen');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const terminalContainer = document.getElementById('terminal-container');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const toolbar = document.getElementById('mobile-toolbar');

  // State
  let token = localStorage.getItem('terminal_token');
  let ws = null;
  let term = null;
  let fitAddon = null;
  let reconnectTimeout = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  // Update status indicator
  function setStatus(status, text) {
    statusEl.className = status;
    statusText.textContent = text;
    statusEl.classList.remove('hidden');
  }

  // Initialize terminal
  function initTerminal() {
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
      allowTransparency: true,
      scrollback: 5000
    });

    fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalContainer);
    fitAddon.fit();

    // Handle terminal input
    term.onData(data => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (fitAddon) {
        fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows
          }));
        }
      }
    });

    // Focus terminal on click
    terminalContainer.addEventListener('click', () => {
      term.focus();
    });
  }

  // Connect to WebSocket
  function connect() {
    if (!token) {
      showLogin();
      return;
    }

    setStatus('connecting', 'Connecting...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      reconnectAttempts = 0;

      // Send auth with terminal dimensions
      ws.send(JSON.stringify({
        type: 'auth',
        token: token,
        cols: term ? term.cols : 80,
        rows: term ? term.rows : 24
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'authenticated':
            setStatus('connected', 'Connected');
            showTerminal();
            if (term) {
              term.focus();
              term.clear();
            }
            break;

          case 'output':
            if (term) {
              term.write(message.data);
            }
            break;

          case 'exit':
            term.writeln('\r\n[Process exited]');
            break;

          case 'error':
            if (message.error.includes('Invalid') || message.error.includes('expired')) {
              localStorage.removeItem('terminal_token');
              token = null;
              showLogin();
              loginError.textContent = 'Session expired. Please log in again.';
            }
            break;
        }
      } catch (err) {
        console.error('Message parse error:', err);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected', 'Disconnected');

      if (token && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setStatus('connecting', `Reconnecting in ${delay / 1000}s...`);
        reconnectTimeout = setTimeout(connect, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  // Show login screen
  function showLogin() {
    loginScreen.classList.remove('hidden');
    terminalScreen.classList.add('hidden');
    statusEl.classList.add('hidden');
    passwordInput.focus();
  }

  // Show terminal screen
  function showTerminal() {
    loginScreen.classList.add('hidden');
    terminalScreen.classList.remove('hidden');

    if (!term) {
      initTerminal();
    }
  }

  // Handle login form submission
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

  // Handle mobile toolbar buttons
  toolbar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    const key = button.dataset.key;
    const ctrl = button.dataset.ctrl;

    if (term) {
      if (key === 'Escape') {
        term.focus();
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

  // Prevent zoom on double-tap
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - (document.lastTouchEnd || 0) < 300) {
      e.preventDefault();
    }
    document.lastTouchEnd = now;
  }, { passive: false });

  // Initialize
  if (token) {
    showTerminal();
    connect();
  } else {
    showLogin();
  }
})();
