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
  const gitCloneBtn = document.getElementById('git-clone-btn');
  const gitInitBtn = document.getElementById('git-init-btn');
  const gitRemoteBtn = document.getElementById('git-remote-btn');
  const gitPullBtn = document.getElementById('git-pull-btn');
  const gitPushBtn = document.getElementById('git-push-btn');
  const gitOriginUrl = document.getElementById('git-origin-url');
  const gitCopyOriginBtn = document.getElementById('git-copy-origin-btn');
  const gitRepoHint = document.getElementById('git-repo-hint');
  const terminalContainer = document.getElementById('terminal-container');
  const currentCliLabel = document.getElementById('current-cli');
  const exitBtn = document.getElementById('exit-btn');
  const switchBtn = document.getElementById('switch-btn');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const toolbar = document.getElementById('mobile-toolbar');
  const themeToggleButtons = Array.from(document.querySelectorAll('[data-theme-toggle]'));
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const launcherTabButtons = Array.from(document.querySelectorAll('[data-launcher-tab]'));
  const filesList = document.getElementById('files-list');
  const filesFilter = document.getElementById('files-filter');
  const filesPathLabel = document.getElementById('files-path');
  const filesUpBtn = document.getElementById('files-up-btn');
  const refreshFilesBtn = document.getElementById('refresh-files-btn');
  const filesCount = document.getElementById('files-count');
  const filesError = document.getElementById('files-error');
  const fileModal = document.getElementById('file-modal');
  const fileModalTitle = document.getElementById('file-modal-title');
  const fileModalClose = document.getElementById('file-modal-close');
  const fileModalContent = document.getElementById('file-modal-content');
  const fileModalEditor = document.getElementById('file-modal-editor');
  const fileCopyPathBtn = document.getElementById('file-copy-path-btn');
  const fileOpenTerminalBtn = document.getElementById('file-open-terminal-btn');
  const fileEditBtn = document.getElementById('file-edit-btn');
  const fileSaveBtn = document.getElementById('file-save-btn');

  // CLI Icons
  const CLI_ICONS = {
    opencode: '🛠️',
    kilo: '🧰',
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
  let terminalFontSize = null;
  const THEME_STORAGE_KEY = 'pocket_terminal_theme';
  const PROJECTS_CACHE_KEY = 'pocket_terminal_projects_cache';
  const LAUNCHER_TAB_STORAGE_KEY = 'pocket_terminal_launcher_tab';
  let activeTheme = null;
  let pendingTerminalInput = null;
  let launcherTab = 'tools';

  let currentFilesDir = '';
  let currentFiles = [];
  let activeFilePath = '';
  let activeFileContent = '';
  let isFileEditing = false;

  function loadCachedProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.projects) ? parsed.projects : null;
      if (!list) return null;
      return list.filter((p) => typeof p?.name === 'string');
    } catch {
      return null;
    }
  }

  function normalizeLauncherTab(value) {
    if (value === 'tools' || value === 'files' || value === 'git') return value;
    return 'tools';
  }

  function applyLauncherTab(nextTab, { persist = true } = {}) {
    const normalized = normalizeLauncherTab(nextTab);
    launcherTab = normalized;
    document.body.dataset.launcherTab = normalized;

    if (persist) {
      localStorage.setItem(LAUNCHER_TAB_STORAGE_KEY, normalized);
    }

    launcherTabButtons.forEach((button) => {
      const active = button.dataset.launcherTab === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function saveCachedProjects(list) {
    try {
      const projects = Array.isArray(list) ? list : [];
      localStorage.setItem(
        PROJECTS_CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), projects }),
      );
    } catch {
      // ignore
    }
  }

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

  function getTerminalFontSize() {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (width <= 360) return 12;
    if (width <= 420) return 13;
    return 14;
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

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let size = bytes / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
    return `${rounded} ${units[unitIndex]}`;
  }

  function setFilesError(message) {
    if (!filesError) return;
    if (!message) {
      filesError.textContent = '';
      filesError.classList.add('hidden');
      return;
    }
    filesError.textContent = message;
    filesError.classList.remove('hidden');
  }

  function updateFilesHeader() {
    if (filesPathLabel) {
      filesPathLabel.textContent = currentFilesDir ? `/${currentFilesDir}` : '/';
    }

    if (filesUpBtn) {
      filesUpBtn.disabled = !selectedProject || !currentFilesDir;
    }

    if (refreshFilesBtn) {
      refreshFilesBtn.disabled = !selectedProject;
    }

    if (filesCount) {
      const count = Array.isArray(currentFiles) ? currentFiles.length : 0;
      filesCount.textContent = selectedProject ? `${count}` : '';
    }
  }

  function renderFilesList() {
    if (!filesList) return;

    updateFilesHeader();

    if (!selectedProject) {
      currentFiles = [];
      currentFilesDir = '';
      setFilesError(null);
      filesList.innerHTML = '<div class="files-empty">Select a project to view files.</div>';
      return;
    }

    const query = String(filesFilter?.value || '').trim().toLowerCase();
    const list = Array.isArray(currentFiles) ? currentFiles : [];
    const filtered = query
      ? list.filter((entry) => String(entry.name || '').toLowerCase().includes(query))
      : list;

    if (!filtered.length) {
      filesList.innerHTML = '<div class="files-empty">No matching files.</div>';
      return;
    }

    filesList.innerHTML = filtered
      .map((entry) => {
        const type = entry.type || 'other';
        const icon = type === 'dir' ? '📁' : type === 'file' ? '📄' : '❓';
        const meta = type === 'file' && entry.size != null ? formatBytes(entry.size) : '';
        return `
          <button class="file-row" type="button" data-file-path="${escapeHtml(entry.path)}" data-file-type="${escapeHtml(type)}">
            <span class="file-icon">${icon}</span>
            <span class="file-name" title="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</span>
            <span class="file-meta">${escapeHtml(meta)}</span>
          </button>
        `;
      })
      .join('');
  }

  async function fetchFiles(dirPath = '') {
    if (!filesList) return;

    setFilesError(null);

    if (!selectedProject) {
      currentFilesDir = '';
      currentFiles = [];
      renderFilesList();
      return;
    }

    filesList.innerHTML = '<div class="files-empty">Loading…</div>';

    try {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(selectedProject)}/files?path=${encodeURIComponent(dirPath)}`,
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      currentFilesDir = typeof data.path === 'string' ? data.path : '';
      currentFiles = Array.isArray(data.entries) ? data.entries : [];
      renderFilesList();
    } catch (err) {
      console.error('Failed to fetch files:', err);
      currentFilesDir = '';
      currentFiles = [];
      renderFilesList();
      setFilesError(err.message || 'Failed to load files');
    }
  }

  function openFileModal() {
    if (!fileModal) return;
    fileModal.classList.remove('hidden');
  }

  function closeFileModal() {
    if (!fileModal) return;
    fileModal.classList.add('hidden');
    activeFilePath = '';
    activeFileContent = '';
    isFileEditing = false;
    if (fileModalEditor) fileModalEditor.classList.add('hidden');
    if (fileModalContent) fileModalContent.classList.remove('hidden');
    if (fileSaveBtn) fileSaveBtn.classList.add('hidden');
    if (fileEditBtn) fileEditBtn.classList.remove('hidden');
  }

  function setFileEditing(editing) {
    isFileEditing = Boolean(editing);
    if (fileModalEditor) fileModalEditor.classList.toggle('hidden', !isFileEditing);
    if (fileModalContent) fileModalContent.classList.toggle('hidden', isFileEditing);
    if (fileSaveBtn) fileSaveBtn.classList.toggle('hidden', !isFileEditing);
    if (fileEditBtn) fileEditBtn.classList.toggle('hidden', isFileEditing);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // ignore
      }
    }

    const manual = window.prompt('Copy to clipboard:', text);
    return manual !== null;
  }

  function shellEscapePosix(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
  }

  function buildEditorCommand(filePath) {
    const escaped = shellEscapePosix(filePath);
    return [
      `if command -v nano >/dev/null 2>&1; then nano ${escaped};`,
      `elif command -v vim >/dev/null 2>&1; then vim ${escaped};`,
      `elif command -v vi >/dev/null 2>&1; then vi ${escaped};`,
      'else echo "No editor found (nano/vim/vi)."; fi',
      '',
    ].join('\n');
  }

  function sendTerminalInput(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'input', data }));
    return true;
  }

  async function openFileInTerminal(filePath) {
    if (!filePath || !selectedProject) return;

    const command = buildEditorCommand(filePath);
    const onTerminalScreen = document.body.dataset.screen === 'terminal';

    if (onTerminalScreen && currentCli === 'bash') {
      sendTerminalInput(command);
      return;
    }

    if (onTerminalScreen && currentCli && currentCli !== 'bash') {
      const ok = window.confirm(
        'This will stop the current CLI session and open Bash to edit the file. Continue?',
      );
      if (!ok) return;
    }

    pendingTerminalInput = command;
    launchCLI('bash', 'Bash Shell');
  }

  async function openProjectFile(filePath) {
    if (!fileModalTitle || !fileModalContent || !fileModalEditor) return;
    if (!selectedProject) {
      setFilesError('Select a project first.');
      return;
    }

    activeFilePath = filePath;
    activeFileContent = '';
    setFileEditing(false);

    fileModalTitle.textContent = filePath;
    fileModalContent.textContent = 'Loading…';
    fileModalEditor.value = '';
    openFileModal();

    try {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(selectedProject)}/file?path=${encodeURIComponent(filePath)}`,
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      activeFileContent = typeof data.content === 'string' ? data.content : '';
      fileModalContent.textContent = activeFileContent;
      fileModalEditor.value = activeFileContent;
    } catch (err) {
      console.error('Failed to open file:', err);
      fileModalContent.textContent = err.message || 'Failed to open file';
      setFileEditing(false);
    }
  }

  async function saveActiveFile() {
    if (!selectedProject || !activeFilePath || !fileModalEditor) return;

    const content = fileModalEditor.value;
    try {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(selectedProject)}/file`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeFilePath, content }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      activeFileContent = content;
      if (fileModalContent) fileModalContent.textContent = content;
      setFileEditing(false);
      setLauncherMessage(`Saved: ${activeFilePath}`);
      fetchGitStatus();
      fetchFiles(currentFilesDir);
    } catch (err) {
      console.error('Failed to save file:', err);
      setLauncherMessage(null);
      setFilesError(err.message || 'Failed to save file');
    }
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
      applyLauncherTab(launcherTab, { persist: false });
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
      saveCachedProjects(projects);
      renderProjectPicker();
      fetchGitStatus();
      fetchGitRepo();
      fetchFiles();
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      const cached = loadCachedProjects();
      if (cached?.length) {
        projects = cached;
        renderProjectPicker();
        setLauncherError('Could not refresh projects (showing cached list).');
        fetchGitStatus();
        fetchGitRepo();
        fetchFiles();
      } else {
        projects = [];
        projectSelect.innerHTML = '<option value="">Projects (root)</option>';
        setLauncherError('Could not load projects.');
      }
    }
  }

  function setGitRepoHint(message) {
    if (!gitRepoHint) return;
    if (!message) {
      gitRepoHint.textContent = '';
      gitRepoHint.classList.add('hidden');
      return;
    }
    gitRepoHint.textContent = message;
    gitRepoHint.classList.remove('hidden');
  }

  function setGitOriginUrl(url) {
    if (!gitOriginUrl) return;
    const normalized = typeof url === 'string' ? url.trim() : '';
    gitOriginUrl.textContent = normalized || '—';
    gitOriginUrl.title = normalized || '';
    if (gitCopyOriginBtn) gitCopyOriginBtn.disabled = !normalized;
  }

  function updateGitRepoControls({ hasProject, isGitRepo, originUrl } = {}) {
    const canManage = Boolean(hasProject);
    const isRepo = Boolean(isGitRepo);
    const hasOrigin = Boolean(originUrl);

    if (gitInitBtn) gitInitBtn.disabled = !canManage || isRepo;
    if (gitRemoteBtn) gitRemoteBtn.disabled = !canManage;

    const canSync = canManage && isRepo && hasOrigin;
    if (gitPullBtn) gitPullBtn.disabled = !canSync;
    if (gitPushBtn) gitPushBtn.disabled = !canSync;
  }

  function deriveProjectNameFromRepoInput(repo) {
    const raw = String(repo || '').trim();
    if (!raw) return '';

    let base = raw;

    const looksLikeSlug =
      /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw) ||
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw);

    if (looksLikeSlug) {
      base = raw.includes('/') ? raw.split('/').pop() : raw;
    } else if (raw.includes('://')) {
      try {
        const parsed = new URL(raw);
        base = parsed.pathname.split('/').filter(Boolean).pop() || raw;
      } catch {
        // ignore
      }
    } else if (raw.startsWith('git@')) {
      const afterColon = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
      base = afterColon.split('/').filter(Boolean).pop() || raw;
    }

    base = base.replace(/\.git$/i, '');
    let cleaned = base.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    if (!cleaned) return '';
    if (cleaned.length > 64) cleaned = cleaned.slice(0, 64).replace(/-+$/, '');
    return cleaned;
  }

  async function fetchGitRepo() {
    if (!gitStatusPanel) return;

    gitStatusPanel.classList.remove('hidden');

    if (!selectedProject) {
      if (gitBranchName) gitBranchName.textContent = '—';
      if (gitCommitCount) gitCommitCount.textContent = '';
      setGitOriginUrl('');
      setGitRepoHint('Select a project, or Clone a repo to create one.');
      updateGitRepoControls({ hasProject: false, isGitRepo: false, originUrl: '' });
      return;
    }

    setGitRepoHint(null);

    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(selectedProject)}/git-repo`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      if (!data.isGitRepo) {
        setGitOriginUrl('');
        setGitRepoHint('Not a git repository. Use Init to start, or Clone a repo.');
        updateGitRepoControls({ hasProject: true, isGitRepo: false, originUrl: '' });
        return;
      }

      const originUrl = typeof data.originUrl === 'string' ? data.originUrl : '';
      if (gitBranchName && data.branch) gitBranchName.textContent = data.branch;
      setGitOriginUrl(originUrl);
      updateGitRepoControls({ hasProject: true, isGitRepo: true, originUrl });
      if (!originUrl) {
        setGitRepoHint('No origin remote set. Use Remote to add one.');
      }
    } catch (err) {
      console.error('Failed to fetch git repo:', err);
      setGitOriginUrl('');
      setGitRepoHint('Failed to load repository info.');
      updateGitRepoControls({ hasProject: Boolean(selectedProject), isGitRepo: false, originUrl: '' });
    }
  }

  async function fetchGitStatus() {
    if (!gitStatusPanel) return;

    gitStatusPanel.classList.remove('hidden');

    if (!selectedProject) {
      if (gitBranchName) gitBranchName.textContent = '—';
      if (gitCommitCount) gitCommitCount.textContent = '';
      if (gitStatusContent) {
        gitStatusContent.innerHTML =
          '<div class="git-status-empty">Select a project to see git status</div>';
      }
      return;
    }

    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(selectedProject)}/git-status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      if (!data.isGitRepo) {
        if (gitBranchName) gitBranchName.textContent = '—';
        if (gitCommitCount) gitCommitCount.textContent = '';
        if (gitStatusContent) {
          gitStatusContent.innerHTML =
            '<div class="git-status-empty">Not a git repository</div>';
        }
        return;
      }

      renderGitStatus(data);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
      if (gitBranchName) gitBranchName.textContent = '—';
      if (gitCommitCount) gitCommitCount.textContent = '';
      if (gitStatusContent) {
        gitStatusContent.innerHTML =
          '<div class="git-status-empty">Failed to load git status</div>';
      }
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

    terminalFontSize = getTerminalFontSize();
    term = new Terminal({
      cursorBlink: true,
      fontSize: terminalFontSize,
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
      const nextSize = getTerminalFontSize();
      if (nextSize !== terminalFontSize) {
        terminalFontSize = nextSize;
        term.setOption('fontSize', terminalFontSize);
      }
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
              if (pendingTerminalInput) {
                sendTerminalInput(pendingTerminalInput);
                pendingTerminalInput = null;
              }
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
    fetchFiles(currentFilesDir);
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
    fetchFiles(currentFilesDir);
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
      fetchFiles(currentFilesDir);
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
      fetchGitRepo();
      fetchFiles();
      closeFileModal();
      if (filesFilter) filesFilter.value = '';
    });
  }

  if (refreshGitBtn) {
    refreshGitBtn.addEventListener('click', () => {
      fetchGitStatus();
      fetchGitRepo();
    });
  }

  if (gitCloneBtn) {
    gitCloneBtn.addEventListener('click', async () => {
      const repoInput = window.prompt('Repository to clone (owner/repo or full URL):');
      if (repoInput === null) return;
      const repo = String(repoInput).trim();
      if (!repo) return;

      const suggestedProjectName = deriveProjectNameFromRepoInput(repo);
      const projectNameInput = window.prompt(
        'Project name (optional):',
        suggestedProjectName,
      );
      if (projectNameInput === null) return;

      const projectName = String(projectNameInput || '').trim();

      setLauncherError(null);
      setLauncherMessage('Cloning repository…');
      gitCloneBtn.disabled = true;

      try {
        const body = { repo };
        if (projectName) body.projectName = projectName;

        const response = await apiFetch('/api/projects/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to clone repository');
        }

        selectedProject = data.project?.name || '';
        if (selectedProject) {
          localStorage.setItem('terminal_project', selectedProject);
        }

        setLauncherMessage(
          selectedProject ? `Cloned into project: ${selectedProject}` : 'Repository cloned.',
        );

        await fetchProjects();
      } catch (err) {
        console.error('Clone error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to clone repository');
      } finally {
        gitCloneBtn.disabled = false;
      }
    });
  }

  if (gitInitBtn) {
    gitInitBtn.addEventListener('click', async () => {
      if (!selectedProject) {
        setLauncherError('Select a project first.');
        return;
      }

      setLauncherError(null);
      setLauncherMessage('Initializing git repository…');
      gitInitBtn.disabled = true;

      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(selectedProject)}/git-init`,
          { method: 'POST' },
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to initialize repository');
        }

        setLauncherMessage(data.initialized ? 'Git repository initialized.' : 'Already a git repository.');
        fetchGitStatus();
        fetchGitRepo();
      } catch (err) {
        console.error('Git init error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to initialize repository');
      } finally {
        gitInitBtn.disabled = false;
      }
    });
  }

  if (gitRemoteBtn) {
    gitRemoteBtn.addEventListener('click', async () => {
      if (!selectedProject) {
        setLauncherError('Select a project first.');
        return;
      }

      const currentOrigin =
        gitOriginUrl && gitOriginUrl.textContent !== '—' ? gitOriginUrl.textContent : '';

      const urlInput = window.prompt(
        'Origin remote URL (https://... or git@...):',
        currentOrigin,
      );
      if (urlInput === null) return;
      const url = String(urlInput).trim();
      if (!url) return;

      setLauncherError(null);
      setLauncherMessage('Updating remote…');
      gitRemoteBtn.disabled = true;

      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(selectedProject)}/git-remote`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'origin', url }),
          },
        );

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to update remote');
        }

        setLauncherMessage('Remote updated.');
        fetchGitRepo();
      } catch (err) {
        console.error('Remote update error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to update remote');
      } finally {
        gitRemoteBtn.disabled = false;
      }
    });
  }

  if (gitPullBtn) {
    gitPullBtn.addEventListener('click', async () => {
      if (!selectedProject) {
        setLauncherError('Select a project first.');
        return;
      }

      setLauncherError(null);
      setLauncherMessage('Pulling changes…');
      gitPullBtn.disabled = true;

      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(selectedProject)}/git-pull`,
          { method: 'POST' },
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to pull changes');
        }

        const message = data.stdout ? `Pull complete.\n\n${data.stdout}` : 'Pull complete.';
        setLauncherMessage(message);
        fetchGitStatus();
        fetchGitRepo();
        fetchFiles(currentFilesDir);
      } catch (err) {
        console.error('Pull error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to pull changes');
      } finally {
        gitPullBtn.disabled = false;
      }
    });
  }

  if (gitPushBtn) {
    gitPushBtn.addEventListener('click', async () => {
      if (!selectedProject) {
        setLauncherError('Select a project first.');
        return;
      }

      setLauncherError(null);
      setLauncherMessage('Pushing commits…');
      gitPushBtn.disabled = true;

      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(selectedProject)}/git-push`,
          { method: 'POST' },
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to push commits');
        }

        const message = data.stdout ? `Push complete.\n\n${data.stdout}` : 'Push complete.';
        setLauncherMessage(message);
        fetchGitStatus();
        fetchGitRepo();
      } catch (err) {
        console.error('Push error:', err);
        setLauncherMessage(null);
        setLauncherError(err.message || 'Failed to push commits');
      } finally {
        gitPushBtn.disabled = false;
      }
    });
  }

  if (gitCopyOriginBtn) {
    gitCopyOriginBtn.addEventListener('click', async () => {
      const url =
        gitOriginUrl && gitOriginUrl.textContent !== '—' ? gitOriginUrl.textContent : '';
      if (!url) return;
      await copyToClipboard(url);
    });
  }

  if (filesFilter) {
    filesFilter.addEventListener('input', () => {
      renderFilesList();
    });
  }

  if (filesUpBtn) {
    filesUpBtn.addEventListener('click', () => {
      if (!selectedProject || !currentFilesDir) return;
      const parts = currentFilesDir.split('/').filter(Boolean);
      parts.pop();
      fetchFiles(parts.join('/'));
    });
  }

  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener('click', () => {
      fetchFiles(currentFilesDir);
    });
  }

  if (filesList) {
    filesList.addEventListener('click', (e) => {
      const row = e.target.closest('.file-row');
      if (!row) return;
      const filePath = row.dataset.filePath || '';
      const type = row.dataset.fileType || '';
      if (!filePath) return;

      if (type === 'dir') {
        fetchFiles(filePath);
        return;
      }

      if (type === 'file') {
        openProjectFile(filePath);
      }
    });
  }

  if (fileModalClose) {
    fileModalClose.addEventListener('click', () => closeFileModal());
  }

  if (fileModal) {
    fileModal.addEventListener('click', (e) => {
      if (e.target === fileModal) closeFileModal();
    });
  }

  if (fileCopyPathBtn) {
    fileCopyPathBtn.addEventListener('click', () => {
      if (!activeFilePath) return;
      copyToClipboard(activeFilePath);
    });
  }

  if (fileOpenTerminalBtn) {
    fileOpenTerminalBtn.addEventListener('click', () => {
      if (!activeFilePath) return;
      closeFileModal();
      openFileInTerminal(activeFilePath);
    });
  }

  if (fileEditBtn) {
    fileEditBtn.addEventListener('click', () => {
      if (!activeFilePath) return;
      setFileEditing(true);
      fileModalEditor?.focus();
    });
  }

  if (fileSaveBtn) {
    fileSaveBtn.addEventListener('click', () => {
      saveActiveFile();
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
        fetchFiles();
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
      currentFilesDir = '';
      currentFiles = [];
      setFilesError(null);
      closeFileModal();
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

  applyLauncherTab(
    normalizeLauncherTab(localStorage.getItem(LAUNCHER_TAB_STORAGE_KEY)),
    { persist: false },
  );
  launcherTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyLauncherTab(button.dataset.launcherTab);
    });
  });

  document.body.dataset.screen = 'login';

  if (token) {
    connect();
  } else {
    showScreen(loginScreen);
  }
})();
