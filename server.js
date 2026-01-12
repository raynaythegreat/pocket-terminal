require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TERMINAL_PASSWORD || "changeme";

const OPENCODE_BINARY =
  process.platform === "darwin"
    ? path.join(__dirname, "bin", "opencode-darwin")
    : path.join(__dirname, "bin", "opencode");

// Add node_modules/.bin, local bin, and kimi-cli-deps to PATH for CLI tools
const nodeModulesBin = path.join(__dirname, "node_modules", ".bin");
const localBin = path.join(__dirname, "bin");
const kimiBin = path.join(__dirname, "kimi-cli-deps", "bin");
const enhancedPath = `${localBin}:${kimiBin}:${nodeModulesBin}:${process.env.PATH}`;

// Create workspace directory for projects
const workspaceDir =
  process.env.WORKSPACE_DIR || path.join(__dirname, "workspace");
if (!fs.existsSync(workspaceDir)) {
  fs.mkdirSync(workspaceDir, { recursive: true });
}

// Dedicated HOME for CLIs (persists history/config when WORKSPACE_DIR is persistent)
const cliHomeDir =
  process.env.CLI_HOME_DIR || path.join(workspaceDir, "cli-home");
if (!fs.existsSync(cliHomeDir)) {
  fs.mkdirSync(cliHomeDir, { recursive: true });
}

// Default projects directory (keeps multiple repos organized)
const projectsDir = path.join(workspaceDir, "projects");
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

// Available CLI tools configuration
const CLI_TOOLS = {
  opencode: {
    name: "OpenCode",
    command: OPENCODE_BINARY,
    description: "AI coding assistant from Anomaly",
  },
  kilo: {
    name: "Kilo Code",
    commands: [process.env.KILO_COMMAND, "kilo", "kilocode", "kilo-code"],
    description: "AI coding assistant (Kilo Code)",
  },
  kimi: {
    name: "Kimi CLI",
    command: "kimi",
    description: "Moonshot AI CLI agent",
  },
  claude: {
    name: "Claude Code",
    command: "claude",
    description: "Sign in with your Anthropic account",
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    description: "Sign in with your Google account",
  },
  codex: {
    name: "Codex",
    command: "codex",
    description: "Sign in with your OpenAI account",
  },
  grok: {
    name: "Grok",
    command: "grok",
    description: "Sign in with your xAI account",
  },
  copilot: {
    name: "GitHub Copilot",
    command: "gh",
    args: ["copilot"],
    description: "AI pair programmer from GitHub",
  },
  github: {
    name: "GitHub CLI",
    command: "gh",
    description: "Manage repos, PRs, issues & more",
  },
  bash: {
    name: "Bash Shell",
    command: "bash",
    description: "Full terminal - run any command",
  },
};

// Store active sessions and terminals
const sessions = new Map();
const terminals = new Map();

const MAX_PROJECT_FILE_BYTES = 512 * 1024; // 512KB
const MAX_PROJECT_DIR_ENTRIES = 2000;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(command, pathEnv) {
  if (!command) return null;

  const isPathLike =
    path.isAbsolute(command) ||
    command.startsWith("./") ||
    command.startsWith("../") ||
    command.includes("/") ||
    command.includes("\\");

  if (isPathLike) {
    const absolute = path.isAbsolute(command)
      ? command
      : path.resolve(__dirname, command);
    return isExecutable(absolute) ? absolute : null;
  }

  const searchPath = pathEnv || process.env.PATH || "";
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

function resolveCommandAny(commands, pathEnv) {
  const list = Array.isArray(commands) ? commands : [];
  for (const command of list) {
    const resolved = resolveCommand(command, pathEnv);
    if (resolved) return resolved;
  }
  return null;
}

function resolveCliCommand(cli, pathEnv) {
  if (!cli) return null;
  if (typeof cli.command === "string") {
    return resolveCommand(cli.command, pathEnv);
  }
  if (Array.isArray(cli.commands)) {
    return resolveCommandAny(cli.commands, pathEnv);
  }
  return null;
}

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "1mb" }));

// Health check (useful for Render)
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Auth endpoint
app.post("/auth", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = generateToken();
    sessions.set(token, { created: Date.now(), lastActivity: Date.now() });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

function isValidSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  const maxAge = 24 * 60 * 60 * 1000;
  if (Date.now() - session.created > maxAge) {
    sessions.delete(token);
    return false;
  }
  session.lastActivity = Date.now();
  return true;
}

function getTokenFromRequest(req) {
  const authHeader = req.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }
  const token = req.get("x-session-token");
  return token ? token.trim() : null;
}

function requireSession(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token || !isValidSession(token)) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }
  req.sessionToken = token;
  next();
}

function isValidProjectName(name) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/.test(name);
}

function getProjectPath(projectName) {
  if (!projectName || typeof projectName !== "string") return null;
  const trimmed = projectName.trim();
  if (!isValidProjectName(trimmed)) return null;

  const candidate = path.resolve(projectsDir, trimmed);
  const root = path.resolve(projectsDir);
  if (!candidate.startsWith(root + path.sep)) return null;

  try {
    const stat = fs.statSync(candidate);
    return stat.isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function resolveProjectRelativePath(projectPath, inputPath) {
  const raw = typeof inputPath === "string" ? inputPath.trim() : "";
  if (!raw || raw === ".") {
    return { absolutePath: projectPath, relativePath: "" };
  }

  if (raw.includes("\0")) return null;

  const normalizedInput = raw.replaceAll("\\", "/");
  const segments = normalizedInput
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== ".");

  if (segments.some((segment) => segment === "..")) return null;

  const relativePath = segments.join("/");
  const absolutePath = path.resolve(projectPath, relativePath);
  const root = path.resolve(projectPath);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    return null;
  }

  return { absolutePath, relativePath };
}

function isValidGitHubRepoSlug(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  // repo or owner/repo
  const repoOnly = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const ownerRepo = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  return repoOnly.test(trimmed) || ownerRepo.test(trimmed);
}

function getToolsEnv() {
  const homeDir = cliHomeDir || process.env.HOME || "/tmp";
  return {
    ...process.env,
    PATH: enhancedPath,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_DATA_HOME: path.join(homeDir, ".local/share"),
    FORCE_COLOR: "1",
  };
}

function runCommand(
  command,
  args,
  { cwd, env, timeoutMs = 120000 } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 500);
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
        timedOut,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
      });
    });
  });
}

function ensureProjectGitIgnore(projectPath) {
  const gitignorePath = path.join(projectPath, ".gitignore");
  const defaultLines = [".env", ".DS_Store", "node_modules/"];

  const exists = fs.existsSync(gitignorePath);
  let current = "";
  try {
    current = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    // ignore
  }

  if (!exists) {
    try {
      fs.writeFileSync(gitignorePath, `${defaultLines.join("\n")}\n`, {
        flag: "wx",
      });
    } catch {
      // ignore
    }
    return;
  }

  if (!current) {
    try {
      fs.writeFileSync(gitignorePath, `${defaultLines.join("\n")}\n`);
    } catch {
      // ignore
    }
    return;
  }

  const existing = new Set(current.split(/\r?\n/));
  const missing = defaultLines.filter((line) => !existing.has(line));
  if (!missing.length) return;

  try {
    fs.appendFileSync(
      gitignorePath,
      `${current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`,
    );
  } catch {
    // ignore
  }
}

// Get available CLIs endpoint
app.get("/api/clis", requireSession, (req, res) => {
  const clis = Object.entries(CLI_TOOLS).map(([id, cli]) => ({
    id,
    name: cli.name,
    description: cli.description,
    available: Boolean(resolveCliCommand(cli, enhancedPath)),
  }));
  res.json(clis);
});

// List projects (directories under projectsDir)
app.get("/api/projects", requireSession, (_req, res) => {
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projects = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, projects });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to list projects" });
  }
});

// Create a new project directory
app.post("/api/projects", requireSession, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!isValidProjectName(name)) {
    res.status(400).json({
      success: false,
      error: "Invalid project name (use letters, numbers, - or _).",
    });
    return;
  }

  const projectPath = path.join(projectsDir, name);
  try {
    fs.mkdirSync(projectPath, { recursive: false });
  } catch (err) {
    if (err && err.code === "EEXIST") {
      res.status(409).json({ success: false, error: "Project already exists" });
      return;
    }
    res.status(500).json({ success: false, error: "Failed to create project" });
    return;
  }

  try {
    fs.writeFileSync(
      path.join(projectPath, "README.md"),
      `# ${name}\n\nCreated with Pocket Terminal.\n`,
      { flag: "wx" },
    );
  } catch {
    // ignore
  }

  try {
    fs.writeFileSync(
      path.join(projectPath, ".gitignore"),
      ".env\n.DS_Store\nnode_modules/\n",
      { flag: "wx" },
    );
  } catch {
    // ignore
  }

  res.status(201).json({ success: true, project: { name } });
});

// List project files (directory contents)
app.get("/api/projects/:name/files", requireSession, (req, res) => {
  const projectPath = getProjectPath(req.params.name);
  if (!projectPath) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const resolved = resolveProjectRelativePath(projectPath, req.query?.path);
  if (!resolved) {
    res.status(400).json({ success: false, error: "Invalid path" });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved.absolutePath);
  } catch {
    res.status(404).json({ success: false, error: "Path not found" });
    return;
  }

  if (!stat.isDirectory()) {
    res.status(400).json({ success: false, error: "Path is not a directory" });
    return;
  }

  try {
    const entries = fs.readdirSync(resolved.absolutePath, { withFileTypes: true });
    if (entries.length > MAX_PROJECT_DIR_ENTRIES) {
      res.status(413).json({
        success: false,
        error: "Directory too large to list",
      });
      return;
    }

    const items = entries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => {
        const entryPath = resolved.relativePath
          ? `${resolved.relativePath}/${entry.name}`
          : entry.name;

        let size = null;
        let modifiedAt = null;

        if (entry.isFile()) {
          try {
            const fileStat = fs.statSync(path.join(resolved.absolutePath, entry.name));
            size = fileStat.size;
            modifiedAt = fileStat.mtimeMs;
          } catch {
            // ignore
          }
        }

        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory()
            ? "dir"
            : entry.isFile()
              ? "file"
              : "other",
          size,
          modifiedAt,
          hidden: entry.name.startsWith("."),
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) {
          if (a.type === "dir") return -1;
          if (b.type === "dir") return 1;
        }
        return a.name.localeCompare(b.name);
      });

    res.json({
      success: true,
      path: resolved.relativePath,
      entries: items,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to list files",
    });
  }
});

// Read a text file from a project
app.get("/api/projects/:name/file", requireSession, (req, res) => {
  const projectPath = getProjectPath(req.params.name);
  if (!projectPath) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const resolved = resolveProjectRelativePath(projectPath, req.query?.path);
  if (!resolved || !resolved.relativePath) {
    res.status(400).json({ success: false, error: "Invalid path" });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved.absolutePath);
  } catch {
    res.status(404).json({ success: false, error: "File not found" });
    return;
  }

  if (!stat.isFile()) {
    res.status(400).json({ success: false, error: "Path is not a file" });
    return;
  }

  if (stat.size > MAX_PROJECT_FILE_BYTES) {
    res.status(413).json({ success: false, error: "File too large to open" });
    return;
  }

  try {
    const buffer = fs.readFileSync(resolved.absolutePath);
    if (buffer.includes(0)) {
      res.status(415).json({ success: false, error: "Binary files are not supported" });
      return;
    }

    res.json({
      success: true,
      path: resolved.relativePath,
      content: buffer.toString("utf8"),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to read file",
    });
  }
});

// Write a text file to a project (create or overwrite)
app.put("/api/projects/:name/file", requireSession, (req, res) => {
  const projectPath = getProjectPath(req.params.name);
  if (!projectPath) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const filePath = typeof req.body?.path === "string" ? req.body.path : "";
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (content === null) {
    res.status(400).json({ success: false, error: "Missing content" });
    return;
  }

  const resolved = resolveProjectRelativePath(projectPath, filePath);
  if (!resolved || !resolved.relativePath) {
    res.status(400).json({ success: false, error: "Invalid path" });
    return;
  }

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_PROJECT_FILE_BYTES) {
    res.status(413).json({ success: false, error: "File too large to save" });
    return;
  }

  const parentDir = path.dirname(resolved.absolutePath);
  try {
    const parentStat = fs.statSync(parentDir);
    if (!parentStat.isDirectory()) {
      res.status(400).json({ success: false, error: "Invalid parent directory" });
      return;
    }
  } catch {
    res.status(400).json({ success: false, error: "Parent directory does not exist" });
    return;
  }

  try {
    fs.writeFileSync(resolved.absolutePath, content, "utf8");
    res.json({ success: true, path: resolved.relativePath });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to write file",
    });
  }
});

// Publish a project to a new GitHub repo
app.post("/api/projects/:name/publish/github", requireSession, async (req, res) => {
  const projectPath = getProjectPath(req.params.name);
  if (!projectPath) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const repoName =
    typeof req.body?.repoName === "string" ? req.body.repoName.trim() : "";
  const visibility =
    req.body?.visibility === "private" ? "private" : "public";

  if (!isValidGitHubRepoSlug(repoName)) {
    res.status(400).json({
      success: false,
      error: "Invalid repo name (use repo or owner/repo).",
    });
    return;
  }

  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) {
    res.status(400).json({
      success: false,
      error:
        "Missing GitHub token. Set GH_TOKEN or GITHUB_TOKEN in your environment.",
    });
    return;
  }

  const ghCommand = resolveCommand("gh", enhancedPath);
  if (!ghCommand) {
    res.status(500).json({
      success: false,
      error: "GitHub CLI (gh) is not installed on this server.",
    });
    return;
  }

  const gitCommand = resolveCommand("git", enhancedPath);
  if (!gitCommand) {
    res.status(500).json({
      success: false,
      error: "git is not installed on this server.",
    });
    return;
  }

  const env = {
    ...getToolsEnv(),
    GH_TOKEN: ghToken,
    GITHUB_TOKEN: ghToken,
  };

  try {
    ensureProjectGitIgnore(projectPath);

    if (!fs.existsSync(path.join(projectPath, ".git"))) {
      const init = await runCommand(gitCommand, ["init"], {
        cwd: projectPath,
        env,
      });
      if (init.timedOut) {
        res.status(504).json({ success: false, error: "git init timed out" });
        return;
      }
      if (init.code !== 0) {
        res.status(500).json({
          success: false,
          error: init.stderr || init.stdout || "git init failed",
        });
        return;
      }
    }

    await runCommand(
      gitCommand,
      ["config", "user.name", process.env.GIT_AUTHOR_NAME || "Pocket Terminal"],
      { cwd: projectPath, env },
    );
    await runCommand(
      gitCommand,
      [
        "config",
        "user.email",
        process.env.GIT_AUTHOR_EMAIL ||
          "pocket-terminal@users.noreply.github.com",
      ],
      { cwd: projectPath, env },
    );

    const origin = await runCommand(gitCommand, ["remote", "get-url", "origin"], {
      cwd: projectPath,
      env,
    });
    if (origin.code === 0 && origin.stdout.trim()) {
      res.status(409).json({
        success: false,
        error:
          "This project already has a git remote named origin. Remove it or publish manually from the terminal.",
      });
      return;
    }

    const add = await runCommand(gitCommand, ["add", "-A"], {
      cwd: projectPath,
      env,
    });
    if (add.timedOut) {
      res.status(504).json({ success: false, error: "git add timed out" });
      return;
    }
    if (add.code !== 0) {
      res.status(500).json({
        success: false,
        error: add.stderr || add.stdout || "git add failed",
      });
      return;
    }

    const head = await runCommand(gitCommand, ["rev-parse", "--verify", "HEAD"], {
      cwd: projectPath,
      env,
    });
    const hasCommit = head.code === 0;

    if (!hasCommit) {
      const commit = await runCommand(gitCommand, ["commit", "-m", "Initial commit"], {
        cwd: projectPath,
        env,
      });
      if (commit.timedOut) {
        res
          .status(504)
          .json({ success: false, error: "git commit timed out" });
        return;
      }
      if (commit.code !== 0) {
        res.status(500).json({
          success: false,
          error: commit.stderr || commit.stdout || "git commit failed",
        });
        return;
      }
    }

    const createArgs = [
      "repo",
      "create",
      repoName,
      "--source",
      ".",
      "--remote",
      "origin",
      "--push",
      "--confirm",
    ];
    createArgs.push(visibility === "private" ? "--private" : "--public");

    const create = await runCommand(ghCommand, createArgs, {
      cwd: projectPath,
      env,
      timeoutMs: 300000,
    });
    if (create.timedOut) {
      res.status(504).json({ success: false, error: "GitHub publish timed out" });
      return;
    }
    if (create.code !== 0) {
      res.status(500).json({
        success: false,
        error: create.stderr || create.stdout || "GitHub publish failed",
      });
      return;
    }

    let url = "";
    const view = await runCommand(ghCommand, ["repo", "view", "--json", "url"], {
      cwd: projectPath,
      env,
    });
    if (view.code === 0) {
      try {
        const data = JSON.parse(view.stdout);
        url = typeof data?.url === "string" ? data.url : "";
      } catch {
        // ignore
      }
    }

    res.json({
      success: true,
      repo: { url, name: repoName, visibility },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to publish project",
    });
  }
});

// Get git status for a project
app.get("/api/projects/:name/git-status", requireSession, async (req, res) => {
  const projectPath = getProjectPath(req.params.name);
  if (!projectPath) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const gitCommand = resolveCommand("git", enhancedPath);
  if (!gitCommand) {
    res.status(500).json({
      success: false,
      error: "git is not installed on this server.",
    });
    return;
  }

  const env = getToolsEnv();

  try {
    // Check if it's a git repository
    const isGitRepo = await runCommand(
      gitCommand,
      ["rev-parse", "--git-dir"],
      { cwd: projectPath, env, timeoutMs: 5000 }
    );

    if (isGitRepo.code !== 0) {
      res.json({
        success: true,
        isGitRepo: false,
        files: [],
      });
      return;
    }

    // Get status with porcelain format
    const status = await runCommand(
      gitCommand,
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: projectPath, env, timeoutMs: 10000 }
    );

    if (status.timedOut) {
      res.status(504).json({ success: false, error: "git status timed out" });
      return;
    }

    // Parse git status output
    const files = status.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3);

        let status = "unknown";
        if (statusCode === "??") status = "untracked";
        else if (statusCode[0] === "M" || statusCode[1] === "M") status = "modified";
        else if (statusCode[0] === "A") status = "added";
        else if (statusCode[0] === "D") status = "deleted";
        else if (statusCode[0] === "R") status = "renamed";
        else if (statusCode[0] === "C") status = "copied";

        const staged = statusCode[0] !== " " && statusCode[0] !== "?";

        return {
          path: filePath,
          status,
          staged,
          statusCode,
        };
      });

    // Get current branch
    const branch = await runCommand(
      gitCommand,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: projectPath, env, timeoutMs: 5000 }
    );

    // Get commit count
    const commitCount = await runCommand(
      gitCommand,
      ["rev-list", "--count", "HEAD"],
      { cwd: projectPath, env, timeoutMs: 5000 }
    );

    res.json({
      success: true,
      isGitRepo: true,
      files,
      branch: branch.code === 0 ? branch.stdout.trim() : "unknown",
      commitCount: commitCount.code === 0 ? parseInt(commitCount.stdout.trim()) : 0,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message || "Failed to get git status",
    });
  }
});

// WebSocket connection handler
wss.on("connection", (ws) => {
  let authenticated = false;
  let activeTerminal = null;

  function killActiveTerminal() {
    const terminalToKill = activeTerminal;
    if (!terminalToKill) return;

    activeTerminal = null;
    terminals.delete(terminalToKill.id);

    try {
      terminalToKill.pty.kill("SIGTERM");
      setTimeout(() => {
        try {
          terminalToKill.pty.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 500);
    } catch {
      // ignore
    }
  }

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      // Handle authentication
      if (message.type === "auth") {
        if (isValidSession(message.token)) {
          authenticated = true;
          ws.send(JSON.stringify({ type: "authenticated" }));
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Invalid or expired session",
            }),
          );
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      // Handle kill request - important for switching CLIs
      if (message.type === "kill") {
        killActiveTerminal();
        ws.send(JSON.stringify({ type: "killed" }));
        return;
      }

      // Handle launching a CLI
      if (message.type === "launch") {
        const cliId = message.cli || "bash";
        const cli = CLI_TOOLS[cliId];

        if (!cli) {
          ws.send(JSON.stringify({ type: "error", error: "Unknown CLI tool" }));
          return;
        }

        // Kill existing terminal first
        killActiveTerminal();

        const resolvedCommand = resolveCliCommand(cli, enhancedPath);
        if (!resolvedCommand) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `${cli.name} is not installed on this server.`,
            }),
          );
          return;
        }

        const terminalId = crypto.randomBytes(8).toString("hex");

        // Build environment
        const homeDir = cliHomeDir || process.env.HOME || "/tmp";
        const termEnv = {
          ...process.env,
          PATH: enhancedPath,
          TERM: "xterm-256color",
          HOME: homeDir,
          XDG_CONFIG_HOME: path.join(homeDir, ".config"),
          XDG_DATA_HOME: path.join(homeDir, ".local/share"),
          FORCE_COLOR: "1",
        };

        const cols = Math.max(10, Number(message.cols) || 80);
        const rows = Math.max(5, Number(message.rows) || 24);

        let cwd = projectsDir;
        if (typeof message.project === "string" && message.project.trim()) {
          const projectPath = getProjectPath(message.project);
          if (!projectPath) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Project not found (or invalid name).",
              }),
            );
            return;
          }
          cwd = projectPath;
        }

        try {
          // Spawn the CLI with args if specified
          const args = cli.args || [];
          const ptyProcess = pty.spawn(resolvedCommand, args, {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: termEnv,
          });

          activeTerminal = { id: terminalId, cli: cliId, pty: ptyProcess };
          terminals.set(terminalId, ptyProcess);

          ptyProcess.onData((output) => {
            if (
              ws.readyState === WebSocket.OPEN &&
              activeTerminal?.id === terminalId
            ) {
              ws.send(JSON.stringify({ type: "output", data: output }));
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            terminals.delete(terminalId);
            if (activeTerminal?.id === terminalId) {
              activeTerminal = null;
            }

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "exit",
                  code: exitCode,
                  cli: cliId,
                }),
              );
            }
          });

          ws.send(
            JSON.stringify({
              type: "launched",
              terminalId,
              cli: cliId,
              name: cli.name,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Failed to launch ${cli.name}: ${err.message}`,
            }),
          );
        }

        return;
      }

      // Handle terminal input
      if (message.type === "input" && activeTerminal?.pty) {
        activeTerminal.pty.write(message.data);
      }

      // Handle terminal resize
      if (message.type === "resize" && activeTerminal?.pty) {
        const colsValue = Number(message.cols);
        const rowsValue = Number(message.rows);
        const cols = Math.max(
          10,
          Number.isFinite(colsValue) ? colsValue : activeTerminal.pty.cols || 80,
        );
        const rows = Math.max(
          5,
          Number.isFinite(rowsValue) ? rowsValue : activeTerminal.pty.rows || 24,
        );
        activeTerminal.pty.resize(cols, rows);
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
    }
  });

  ws.on("close", () => {
    killActiveTerminal();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

// Clean up expired sessions
setInterval(
  () => {
    const maxAge = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (now - session.created > maxAge) {
        sessions.delete(token);
      }
    }
  },
  60 * 60 * 1000,
);

server.listen(PORT, () => {
  console.log(`Pocket Terminal running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log(`\nAvailable CLIs: ${Object.keys(CLI_TOOLS).join(", ")}`);
});
