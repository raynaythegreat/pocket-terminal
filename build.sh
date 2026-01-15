#!/usr/bin/env bash
set -euo pipefail

echo "Installing npm dependencies (hardened)..."

# Ensure we use the public npm registry (avoid mirror/CDN inconsistencies).
npm config set registry "https://registry.npmjs.org/" >/dev/null

# Add retries/timeouts for flaky networks.
npm config set fetch-retries 5 >/dev/null
npm config set fetch-retry-mintimeout 20000 >/dev/null
npm config set fetch-retry-maxtimeout 120000 >/dev/null

# Clear npm cache to avoid corrupted tarballs causing EINTEGRITY failures.
# This trades build speed for reliability on hosted CI/build environments.
npm cache clean --force >/dev/null || true

# Install dependencies. We intentionally use npm install (not npm ci) because
# the repo's lockfile may drift during rapid iteration and Render uses a cached environment.
npm install --no-audit --no-fund

# Ensure local tool scripts are executable if they exist.
if [ -f "./kimi" ]; then
  chmod +x "./kimi" || true
fi

if [ -f "./opencode" ]; then
  chmod +x "./opencode" || true
fi

echo "Build completed."