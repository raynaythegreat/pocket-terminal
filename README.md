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

## Optional CLIs (openCode, Kimi)

Run `./build.sh` to install optional tools into `./bin` (and Kimi into `./kimi-cli-deps` when Python is available).

## Render

`render.yaml` uses `/healthz` for health checks and mounts a persistent disk for `WORKSPACE_DIR` and `CLI_HOME_DIR`.