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

echo "Ensuring Copilot CLI is available (optional)..."
if [ -x "./node_modules/.bin/copilot" ]; then
  echo "Copilot CLI already installed (node_modules/.bin/copilot)"
elif command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"

  if [ "${NODE_MAJOR}" -ge 22 ]; then
    if npm install --omit=dev --no-save --no-package-lock @github/copilot; then
      echo "Copilot CLI installed (node_modules/.bin/copilot)"
    else
      echo "Copilot CLI install failed; skipping"
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
  echo "npm/node not available; skipping Copilot CLI install"
fi

echo "Ensuring Kilo Code CLI is available (optional)..."
if [ -x "./node_modules/.bin/kilo" ] || [ -x "./node_modules/.bin/kilocode" ]; then
  echo "Kilo Code CLI already installed (node_modules/.bin/kilo)"
elif command -v npm >/dev/null 2>&1; then
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

install_opencode_release() {
  local raw_os os arch archive_ext is_musl needs_baseline target filename url tmp_dir tmp_file extracted target_path

  raw_os=$(uname -s)
  os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
  case "$raw_os" in
    Darwin*) os="darwin" ;;
    Linux*) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
  esac

  arch=$(uname -m)
  if [ "$arch" = "aarch64" ]; then
    arch="arm64"
  fi
  if [ "$arch" = "x86_64" ]; then
    arch="x64"
  fi

  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
    if [ "$rosetta_flag" = "1" ]; then
      arch="arm64"
    fi
  fi

  archive_ext=".zip"
  if [ "$os" = "linux" ]; then
    archive_ext=".tar.gz"
  fi

  needs_baseline=false
  if [ "$arch" = "x64" ]; then
    if [ "$os" = "linux" ]; then
      if [ -r /proc/cpuinfo ] && ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then
        needs_baseline=true
      fi
    elif [ "$os" = "darwin" ]; then
      avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)
      if [ "$avx2" != "1" ]; then
        needs_baseline=true
      fi
    fi
  fi

  is_musl=false
  if [ "$os" = "linux" ]; then
    if [ -f /etc/alpine-release ]; then
      is_musl=true
    elif command -v ldd >/dev/null 2>&1; then
      if ldd --version 2>&1 | grep -qi musl; then
        is_musl=true
      fi
    fi
  fi

  target="$os-$arch"
  if [ "$needs_baseline" = "true" ]; then
    target="$target-baseline"
  fi
  if [ "$is_musl" = "true" ]; then
    target="$target-musl"
  fi

  filename="opencode-${target}${archive_ext}"
  url="https://github.com/anomalyco/opencode/releases/latest/download/${filename}"

  if [ "$os" = "windows" ]; then
    echo "openCode installer does not support Windows builds yet; skipping"
    return 1
  fi

  tmp_dir=$(mktemp -d)
  tmp_file="${tmp_dir}/${filename}"

  echo "Downloading openCode (${filename})..."
  if ! curl -fL "$url" -o "$tmp_file"; then
    echo "openCode download failed; skipping"
    rm -rf "$tmp_dir" 2>/dev/null || true
    return 1
  fi

  if [ "$os" = "linux" ]; then
    if ! command -v tar >/dev/null 2>&1; then
      echo "Error: 'tar' is required but not installed; skipping openCode"
      rm -rf "$tmp_dir" 2>/dev/null || true
      return 1
    fi
    tar -xzf "$tmp_file" -C "$tmp_dir"
  else
    if ! command -v unzip >/dev/null 2>&1; then
      echo "Error: 'unzip' is required but not installed; skipping openCode"
      rm -rf "$tmp_dir" 2>/dev/null || true
      return 1
    fi
    unzip -q "$tmp_file" -d "$tmp_dir"
  fi

  extracted=$(find "$tmp_dir" -maxdepth 4 -type f -name opencode -print -quit 2>/dev/null || true)
  if [ -z "$extracted" ]; then
    echo "openCode binary not found in archive; skipping"
    rm -rf "$tmp_dir" 2>/dev/null || true
    return 1
  fi

  target_path="./bin/opencode"
  if [ "$os" = "darwin" ]; then
    target_path="./bin/opencode-darwin"
  fi

  cp "$extracted" "$target_path"
  chmod +x "$target_path" || true
  echo "openCode CLI installed to ${target_path}"
  rm -rf "$tmp_dir" 2>/dev/null || true
  return 0
}

echo "Installing openCode CLI (optional)..."
OPENCODE_TARGET="./bin/opencode"
if [ "$(uname -s)" = "Darwin" ]; then
  OPENCODE_TARGET="./bin/opencode-darwin"
fi

if [ -x "$OPENCODE_TARGET" ]; then
  echo "openCode CLI already installed (${OPENCODE_TARGET})"
elif command -v curl >/dev/null 2>&1; then
  if ! install_opencode_release; then
    echo "openCode CLI install failed; skipping"
  fi
else
  echo "curl not available; skipping openCode CLI install"
fi

echo "Build complete!"
