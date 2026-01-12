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
  const launcherMessage = document.getElementById('launcher-message');
  const retryBtn = document.getElementById('retry-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const projectSelect = document.getElementById('project-select');
  const newProjectBtn = document.getElementById('new-project-btn');
  const publishGithubBtn = document.getElementById('publish-github-btn');
  const gitStatusPanel = document.getElementById('git-status-panel');
  const gitBranchName = document.getElementById('git-branch-name');
  const gitCommitCount = document.getElementById('git-commit-count');
  const gitStatusContent = document.getElementById('git-status-content');
  const refreshGitBtn = document.getElementById('refresh-git-btn');
  const terminalContainer = document.getElementById('terminal-container');
  const currentCliLabel = document.getElementById('current-cli');
  const exitBtn = document.getElementById('exit-btn');
  const switchBtn = document.getElementById('switch-btn');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const toolbar = document.getElementById('mobile-toolbar');
  const themeToggleButtons = Array.from(document.querySelectorAll('[data-theme-toggle]'));
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  // CLI Icons
  const CLI_ICONS = {
    opencode: '🛠️',
    kimi: '🌙',
    claude: '🤖',
    gemini: '✨',
    codex: '💻',
    grok: '🧠',
    copilot: '🤝',
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
  let projects = [];
  let selectedProject = localStorage.getItem('terminal_project') || '';
  let reconnectAttempt = 0;
  let reconnectTimeoutId = null;
  let listenersAttached = false;
  let manuallyDisconnected = false;
  const THEME_STORAGE_KEY = 'pocket_terminal_theme';
  let activeTheme = null;

  function normalizeTheme(value) {
    if (value === 'light' || value === 'dark') return value;
    return null;
  }

  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function getXtermTheme(theme) {
    if (theme === 'light') {
      return {
        background: '#fbfcff',
        foreground: '#0f172a',
        cursor: '#4f8cff',
        cursorAccent: '#fbfcff',
        selection: 'rgba(79, 140, 255, 0.18)',
        black: '#0f172a',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#b45309',
        blue: '#2563eb',
        magenta: '#7c3aed',
        cyan: '#0891b2',
        white: '#475569',
        brightBlack: '#64748b',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#f59e0b',
        brightBlue: '#4f8cff',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#0f172a'
      };
    }

    return {
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
    };
  }

  function updateThemeToggleButtons(theme) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const icon = nextTheme === 'dark' ? '🌙' : '☀️';
    const label = `Switch to ${nextTheme} theme`;

    themeToggleButtons.forEach((button) => {
      button.textContent = icon;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
  }

  function setThemeMetaColor(theme) {
    if (!themeColorMeta) return;
    themeColorMeta.setAttribute('content', theme === 'light' ? '#f7f8fb' : '#0b1020');
  }

  function applyTheme(theme, { persist = true } = {}) {
    const normalized = normalizeTheme(theme) || 'dark';
    activeTheme = normalized;
    document.documentElement.dataset.theme = normalized;

    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    }

    updateThemeToggleButtons(normalized);
    setThemeMetaColor(normalized);

    if (term) {
      term.setOption('theme', getXtermTheme(normalized));
      term.refresh(0, term.rows - 1);
    }
  }

  function toggleTheme() {
    applyTheme(activeTheme === 'light' ? 'dark' : 'light');
  }

  async function readClipboardText() {
    if (!navigator.clipboard?.readText) return '';
    try {
      return await navigator.clipboard.readText();
    } catch (err) {
      return '';
    }
  }

  async function handlePasteAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let text = await readClipboardText();
    if (!text) {
      const manual = window.prompt('Paste text to send to the terminal:');
      if (manual === null) return;
      text = manual;
    }

    if (!text) return;

    if (term?.paste) {
      term.paste(text);
      term.focus();
      return;
    }

    ws.send(JSON.stringify({ type: 'input', data: text }));
  }

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

  function setLauncherMessage(message) {
    if (!launcherMessage) return;

    if (!message) {
      launcherMessage.textContent = '';
      launcherMessage.classList.add('hidden');
      return;
    }

    launcherMessage.textContent = message;
    launcherMessage.classList.remove('hidden');
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
      document.body.dataset.screen = 'login';
    } else if (screen === launcherScreen) {
      document.body.dataset.screen = 'launcher';
    } else if (screen === terminalScreen) {
      document.body.dataset.screen = 'terminal';
    } else {
      delete document.body.dataset.screen;
    }

    if (screen === loginScreen) {
      passwordInput.focus();
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem('terminal_token');
      token = null;
      manuallyDisconnected = true;
      showScreen(loginScreen);
      loginError.textContent = 'Please log in again.';
      throw new Error('Not authenticated');
    }
    return response;
  }

  function renderProjectPicker() {
    if (!projectSelect) return;

    const normalized = Array.isArray(projects) ? projects : [];
    const options = [
      { value: '', label: 'Projects (root)' },
      ...normalized.map((p) => ({ value: p.name, label: p.name })),
    ];

    projectSelect.innerHTML = options
      .map(
        (opt) =>
          `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`,
      )
      .join('');

    const hasSelected =
      selectedProject &&
      normalized.some((p) => String(p.name) === String(selectedProject));
    projectSelect.value = hasSelected ? selectedProject : '';

    if (!hasSelected && selectedProject) {
      selectedProject = '';
      localStorage.removeItem('terminal_project');
    }
  }

  async function fetchProjects() {
    if (!projectSelect) return;

    projectSelect.innerHTML = '<option value="">Loading…</option>';

    try {
      const response = await apiFetch('/api/projects');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      projects = Array.isArray(data.projects) ? data.projects : [];
      renderProjectPicker();
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      projects = [];
      projectSelect.innerHTML = '<option value="">Projects (root)</option>';
    }
  }

  async function fetchGitStatus() {
    if (!gitStatusPanel || !selectedProject) {
      gitStatusPanel.classList.add('hidden');
      return;
    }

    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(selectedProject)}/git-status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      if (!data.isGitRepo) {
        gitStatusPanel.classList.add('hidden');
        return;
      }

      renderGitStatus(data);
      gitStatusPanel.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to fetch git status:', err);
      gitStatusPanel.classList.add('hidden');
    }
  }

  function renderGitStatus(data) {
    if (!gitStatusPanel) return;

    // Update branch name and commit count
    if (gitBranchName && data.branch) {
      gitBranchName.textContent = data.branch;
    }
    if (gitCommitCount && data.commitCount !== undefined) {
      gitCommitCount.textContent = `${data.commitCount} commits`;
    }

    // Render files
    if (!gitStatusContent) return;

    if (!data.files || data.files.length === 0) {
      gitStatusContent.innerHTML = '<div class="git-status-empty">No changes</div>';
      return;
    }

    const filesHtml = data.files
      .map((file) => {
        const statusClass = file.status.toLowerCase();
        const stagedIndicator = file.staged ? '<span class="file-staged-indicator">●</span>' : '';

        return `
          <div class="file-item">
            <span class="file-status-badge ${statusClass}">${file.status}</span>
            <span class="file-path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
            ${stagedIndicator}
          </div>
        `;
      })
      .join('');

    gitStatusContent.innerHTML = filesHtml;
  }

  async function fetchCLIs() {
    setLauncherError(null);
    setLauncherMessage(null);
    setRetryVisible(false);
    cliGrid.innerHTML = '<div class="cli-loading">Loading tools…</div>';

    try {
      const response = await apiFetch('/api/clis');
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
      theme: getXtermTheme(activeTheme),
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
    setLauncherMessage(null);
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
            setLauncherError(null);
            setLauncherMessage(null);
            fetchProjects();
            fetchCLIs();
            fetchGitStatus();
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
    setLauncherMessage(null);
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
        project: selectedProject,
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
    fetchProjects();
    fetchCLIs();
    fetchGitStatus();
  });

  // Switch button - kill terminal and go back to launcher
  switchBtn.addEventListener('click', async () => {
    await killCurrentTerminal();
    if (term) {
      term.clear();
    }
    showScreen(launcherScreen);
    fetchProjects();
    fetchCLIs();
    fetchGitStatus();
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
      setLauncherMessage(null);
      fetchProjects();
      fetchCLIs();
    });
  }

  if (projectSelect) {
    projectSelect.addEventListener('change', () => {
      selectedProject = projectSelect.value || '';
      if (selectedProject) {
        localStorage.setItem('terminal_project', selectedProject);
      } else {
        localStorage.removeItem('terminal_project');
      }
      fetchGitStatus();
    });
  }

  if (refreshGitBtn) {
    refreshGitBtn.addEventListener('click', () => {
      fetchGitStatus();
    });
  }

  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', async () => {
      const name = window.prompt('Project name (letters, numbers, - or _):');
      if (!name) return;

      try {
        setLauncherMessage(null);
        const response = await apiFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to create project');
        }

        selectedProject = data.project?.name || '';
        if (selectedProject) {
          localStorage.setItem('terminal_project', selectedProject);
        }

        fetchProjects();
        fetchGitStatus();
      } catch (err) {
        console.error('Project create error:', err);
        setLauncherError(err.message || 'Failed to create project');
      }
    });
  }

  if (publishGithubBtn) {
    publishGithubBtn.addEventListener('click', async () => {
      if (!selectedProject) {
        setLauncherError('Select or create a project first.');
        return;
      }

      const repoName = window.prompt(
        'New GitHub repo name:',
        selectedProject,
      );
      if (!repoName) return;

      const makePrivate = window.confirm(
        'Make this repo private?\n\nOK = Private\nCancel = Public',
      );

      setLauncherError(null);
      setLauncherMessage('Publishing to GitHub…');

      publishGithubBtn.disabled = true;
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(selectedProject)}/publish/github`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoName,
              visibility: makePrivate ? 'private' : 'public'
            })
          },
        );

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to publish project');
        }

        const url = data.repo?.url || '';
        setLauncherMessage(url ? `Published: ${url}` : 'Published to GitHub.');
        fetchGitStatus();
      } catch (err) {
        console.error('Publish error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to publish project');
      } finally {
        publishGithubBtn.disabled = false;
      }
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
      projects = [];
      setLauncherError(null);
      setLauncherMessage(null);
      setRetryVisible(false);
      showScreen(loginScreen);
    });
  }

  // Mobile toolbar buttons
  toolbar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !ws || ws.readyState !== WebSocket.OPEN) return;

    const action = button.dataset.action;
    if (action === 'paste') {
      handlePasteAction();
      return;
    }

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
  const storedTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  applyTheme(storedTheme || getSystemTheme(), { persist: false });
  themeToggleButtons.forEach((button) => {
    button.addEventListener('click', toggleTheme);
  });

  document.body.dataset.screen = 'login';

  if (token) {
    connect();
  } else {
    showScreen(loginScreen);
  }
})();
