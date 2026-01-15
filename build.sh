#!/usr/bin/env bash
set -euo pipefail

echo "Installing npm dependencies..."
# Render runs `npm ci` by default in many templates, but this repo's lockfile can drift
# (especially with optional dependencies). Using `npm install` is more forgiving and
# unblocks deployments. For fully reproducible builds, regenerate package-lock.json
# and switch back to `npm ci`.
npm install --no-audit --no-fund

# Ensure local CLI scripts are executable (safe even if already executable)
if [ -f "./kimi" ]; then
  chmod +x ./kimi || true
fi

if [ -f "./opencode" ]; then
  chmod +x ./opencode || true
fi

echo "Build complete."