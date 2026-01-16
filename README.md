# Pocket Terminal

Web-based terminal + AI CLI launchers, designed to be usable from a phone.

## Local setup

1. `cp .env.example .env` (optional)
2. `npm ci`
3. `npm start`

Open `http://localhost:3000`, then use **Quick Launch**.

## Workspace + persistence

- Projects are stored in `WORKSPACE_DIR` (default: `./workspace/projects`)
- CLI config/history uses `CLI_HOME_DIR` (default: `./workspace/cli-home`)

## Tool availability

The launcher now shows which tools are **Ready** (installed and detected) vs **Install** (not detected on the server).

- Some tools are detected from:
  - `./bin` (created by `./build.sh`)
  - `./node_modules/.bin`
  - System PATH (if installed in your OS image)
- Some tools can run via `npx` when configured.

## Optional CLIs (openCode, Kimi)

Run `./build.sh` to install optional tools into `./bin` (and Kimi into `./kimi-cli-deps` when Python is available).

## Secrets / API keys

Set secrets in your hosting environment variables (Vercel or Render) or `.env.local`:

- Claude Code: `ANTHROPIC_API_KEY`
- Gemini: `GEMINI_API_KEY`
- OpenAI/Codex: `OPENAI_API_KEY`

## Render

`render.yaml` uses `/healthz` for health checks and mounts a persistent disk for `WORKSPACE_DIR` and `CLI_HOME_DIR`.

To make more CLIs available on Render, ensure your Render build step installs them (or run `./build.sh` during build).