#!/bin/bash
# Build script for Render - installs dependencies including GitHub CLI, openCode, and Kimi CLI

set -e

mkdir -p ./bin

echo "Installing npm dependencies..."
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "Installing GitHub CLI (optional)..."
if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
  # Download and install gh CLI
  GH_VERSION="2.45.0"
  if curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o gh.tar.gz; then
    tar -xzf gh.tar.gz
    if [ -f "gh_${GH_VERSION}_linux_amd64/bin/gh" ]; then
      mv "gh_${GH_VERSION}_linux_amd64/bin/gh" ./bin/
      echo "GitHub CLI installed to ./bin/gh"
    else
      echo "GitHub CLI download succeeded but binary not found; skipping"
    fi
    rm -rf gh.tar.gz "gh_${GH_VERSION}_linux_amd64"
  else
    echo "GitHub CLI download failed; skipping"
  fi
else
  echo "curl/tar not available; skipping GitHub CLI install"
fi

echo "Installing Kimi CLI (optional)..."
if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
  if python3 -m pip install kimi-cli --target ./kimi-cli-deps; then
    # Copy kimi CLI binary to bin (best-effort)
    if [ -f ./kimi-cli-deps/bin/kimi ]; then
      cp ./kimi-cli-deps/bin/kimi ./bin/kimi
      chmod +x ./bin/kimi || true
      echo "Kimi CLI installed to ./bin/kimi"
    else
      echo "Kimi CLI installed, but entrypoint not found at ./kimi-cli-deps/bin/kimi"
    fi
  else
    echo "Kimi CLI install failed; skipping"
  fi
else
  echo "python3/pip not available; skipping Kimi CLI install"
fi

echo "Installing openCode CLI (optional)..."
if command -v curl >/dev/null 2>&1 && command -v bash >/dev/null 2>&1; then
  set +e
  curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path
  OPENCODE_EXIT=$?
  set -e

  OPENCODE_SOURCE="${HOME:-/tmp}/.opencode/bin/opencode"
  if [ "$OPENCODE_EXIT" -eq 0 ] && [ -f "$OPENCODE_SOURCE" ]; then
    cp "$OPENCODE_SOURCE" ./bin/opencode
    chmod +x ./bin/opencode || true
    echo "openCode CLI installed to ./bin/opencode"
  else
    echo "openCode CLI install failed; skipping"
  fi
else
  echo "curl/bash not available; skipping openCode CLI install"
fi

echo "Build complete!"
