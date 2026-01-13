#!/bin/bash
# Build script for Render - installs dependencies and optional AI CLIs

set -e

mkdir -p ./bin

create_node_cli_wrapper() {
  local name="$1"
  local relative_script="$2"

  if [ -f "./${relative_script}" ]; then
    cat > "./bin/${name}" <<EOF
#!/usr/bin/env sh
SCRIPT_DIR="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
exec node "\$SCRIPT_DIR/../${relative_script}" "\$@"
EOF
    chmod +x "./bin/${name}" || true
    echo "CLI wrapper ready: ${name}"
  else
    rm -f "./bin/${name}" 2>/dev/null || true
  fi
}

echo "Installing npm dependencies..."
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "Preparing Node CLI wrappers (optional)..."
if command -v node >/dev/null 2>&1; then
  create_node_cli_wrapper "claude" "node_modules/@anthropic-ai/claude-code/cli.js"
  create_node_cli_wrapper "grok" "node_modules/@vibe-kit/grok-cli/dist/index.js"
  create_node_cli_wrapper "gemini" "node_modules/@google/gemini-cli/dist/index.js"
  create_node_cli_wrapper "codex" "node_modules/@openai/codex/bin/codex.js"
else
  echo "node not available; skipping Node CLI wrappers"
fi

echo "Installing GitHub Copilot CLI (optional)..."
if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"

  if [ "${NODE_MAJOR}" -ge 22 ]; then
    if npm install --omit=dev --no-save --no-package-lock @github/copilot; then
      echo "GitHub Copilot CLI installed (node_modules/.bin/copilot)"
    else
      echo "GitHub Copilot CLI install failed; skipping"
    fi
  else
    echo "Node ${NODE_MAJOR} detected; installing legacy Copilot CLI (@githubnext/github-copilot-cli)"
    if npm install --omit=dev --no-save --no-package-lock @githubnext/github-copilot-cli; then
      echo "Legacy Copilot CLI installed (node_modules/.bin/github-copilot-cli)"
    else
      echo "Legacy Copilot CLI install failed; skipping"
    fi
  fi
else
  echo "npm/node not available; skipping GitHub Copilot CLI install"
fi

echo "Installing Kilo Code CLI (optional)..."
if command -v npm >/dev/null 2>&1; then
  if npm install --omit=dev --no-save --no-package-lock @kilocode/cli; then
    echo "Kilo Code CLI installed (node_modules/.bin/kilo, node_modules/.bin/kilocode)"
  else
    echo "Kilo Code CLI install failed; skipping"
  fi
else
  echo "npm not available; skipping Kilo Code CLI install"
fi

echo "Installing Kimi CLI (optional)..."
rm -f ./bin/kimi 2>/dev/null || true
if command -v python3 >/dev/null 2>&1; then
  KIMI_VENV="./kimi-cli-deps"
  KIMI_PY="${KIMI_VENV}/bin/python3"
  if [ ! -x "$KIMI_PY" ]; then
    KIMI_PY="${KIMI_VENV}/bin/python"
  fi

  if [ ! -x "$KIMI_PY" ]; then
    rm -rf "${KIMI_VENV}" 2>/dev/null || true
    if python3 -m venv "${KIMI_VENV}"; then
      KIMI_PY="${KIMI_VENV}/bin/python3"
      if [ ! -x "$KIMI_PY" ]; then
        KIMI_PY="${KIMI_VENV}/bin/python"
      fi
    else
      echo "python venv creation failed; skipping Kimi CLI install"
    fi
  fi

  if [ -x "$KIMI_PY" ] && "$KIMI_PY" -m pip --version >/dev/null 2>&1; then
    "$KIMI_PY" -m pip install --upgrade pip >/dev/null 2>&1 || true
    if "$KIMI_PY" -m pip install kimi-cli; then
      if [ -f "${KIMI_VENV}/bin/kimi" ]; then
        cat > "./bin/kimi" <<EOF
#!/usr/bin/env sh
SCRIPT_DIR="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
exec "\$SCRIPT_DIR/../kimi-cli-deps/bin/kimi" "\$@"
EOF
        chmod +x ./bin/kimi || true
        echo "Kimi CLI installed to ./bin/kimi"
      else
        echo "Kimi CLI installed, but entrypoint not found at ${KIMI_VENV}/bin/kimi"
      fi
    else
      echo "Kimi CLI install failed; skipping"
    fi
  else
    echo "python3/pip not available; skipping Kimi CLI install"
  fi
else
  echo "python3 not available; skipping Kimi CLI install"
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
