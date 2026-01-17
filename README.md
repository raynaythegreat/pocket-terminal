# Pocket Terminal

Web-based terminal + AI CLI launchers, designed to be usable from a phone.

## Local setup

1. `cp .env.example .env` (optional)
2. `npm ci`
3. `./build.sh`
4. `npm start`

Open `http://localhost:3000`, then use **Quick Launch**.

## Workspace + persistence

- Projects are stored in `WORKSPACE_DIR` (default: `./workspace/projects`)
- CLI config/history uses `CLI_HOME_DIR` (default: `./workspace/cli-home`)
  - This app stores per-tool HOME directories under `CLI_HOME_DIR/tools/<toolId>`
  - This prevents auth/config collisions and keeps logins persistent across sessions.
  - The server also sets `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` per tool for better CLI compatibility.

## Tool availability

The launcher shows which tools are **Ready** (installed and detected) vs install hints.

- Tools are resolved from:
  - repo scripts (e.g. `./opencode`)
  - `./bin` (populated by `./build.sh`)
  - `./node_modules/.bin`
  - System PATH

## Copilot CLI (Render / headless)

Pocket Terminal launches Copilot via GitHub CLI:

- Command: `gh copilot ...`
- Auth: run `gh auth login` inside the terminal. Device-code flow works on headless servers.

Note: `gh` must be installed on the host (Render image). If Copilot shows "Not Found", install GitHub CLI in your Render environment.

## Grok CLI

Grok CLI is installed as a local dependency:

- npm package: `@vibe-kit/grok-cli`
- binary: `grok`

Launch **Grok CLI** from Quick Launch, then authenticate using the CLI’s interactive flow (if supported by the CLI).

## Google Account Login (Gemini CLI)

On Render/headless servers, you must use the "no-browser" login flow.

1. Launch **Gemini CLI** (or the standard **Terminal**) from the launcher.
2. Run the following command: