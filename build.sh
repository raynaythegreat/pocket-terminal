#!/usr/bin/env bash
set -euo pipefail

echo "Installing npm dependencies (hardened)..."

# Optional tool installers can be disabled by setting `SKIP_OPTIONAL_TOOLS=1`.
SKIP_OPTIONAL_TOOLS="${SKIP_OPTIONAL_TOOLS:-0}"

mkdir -p ./bin

# Render/CI should be production installs by default (avoid dev deps like vitest).
export NODE_ENV="${NODE_ENV:-production}"

# Use a clean per-build npm cache directory to avoid corrupted restored caches (EINTEGRITY).
NPM_CACHE_DIR="${NPM_CACHE_DIR:-}"
if [ -z "$NPM_CACHE_DIR" ]; then
  NPM_CACHE_DIR="$(mktemp -d)"
fi
export npm_config_cache="$NPM_CACHE_DIR"
rm -rf "$npm_config_cache" >/dev/null 2>&1 || true
mkdir -p "$npm_config_cache"

# Ensure we use the public npm registry (avoid mirror/CDN inconsistencies).
npm config set registry "https://registry.npmjs.org/" >/dev/null

# Add retries/timeouts for flaky networks.
npm config set fetch-retries 5 >/dev/null
npm config set fetch-retry-mintimeout 20000 >/dev/null
npm config set fetch-retry-maxtimeout 120000 >/dev/null

run_npm_install() {
  if [ -f package-lock.json ]; then
    npm ci --omit=dev --no-audit --no-fund
  else
    npm install --omit=dev --no-audit --no-fund
  fi
}

# Retry once on EINTEGRITY (seen on Render when caches/registries serve bad tarballs).
install_log="/tmp/npm-install.log"
if ! run_npm_install 2>&1 | tee "$install_log"; then
  if grep -q "EINTEGRITY" "$install_log"; then
    echo "npm install hit EINTEGRITY; retrying with a fresh npm cache..."
    rm -rf "$npm_config_cache" >/dev/null 2>&1 || true
    mkdir -p "$npm_config_cache"
    rm -rf node_modules >/dev/null 2>&1 || true
    run_npm_install
  else
    echo "npm install failed (see $install_log)"
    exit 1
  fi
fi

# Ensure local tool scripts are executable if they exist.
if [ -f "./kimi" ]; then
  chmod +x "./kimi" || true
fi

if [ -f "./opencode" ]; then
  chmod +x "./opencode" || true
fi

install_kimi_cli() {
  echo "Installing Kimi CLI (optional)..."
  if [ "$SKIP_OPTIONAL_TOOLS" = "1" ]; then
    echo "SKIP_OPTIONAL_TOOLS=1 set; skipping Kimi CLI install"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not available; skipping Kimi CLI install"
    return 0
  fi

  local venv="./kimi-cli-deps"
  local py="${venv}/bin/python3"
  if [ ! -x "$py" ]; then
    py="${venv}/bin/python"
  fi

  if [ ! -x "$py" ]; then
    rm -rf "${venv}" >/dev/null 2>&1 || true
    if python3 -m venv "${venv}"; then
      py="${venv}/bin/python3"
      if [ ! -x "$py" ]; then
        py="${venv}/bin/python"
      fi
    else
      echo "python venv creation failed; skipping Kimi CLI install"
      return 0
    fi
  fi

  if [ ! -x "$py" ]; then
    echo "venv python not found; skipping Kimi CLI install"
    return 0
  fi

  if ! "$py" -m pip --version >/dev/null 2>&1; then
    echo "pip not available; skipping Kimi CLI install"
    return 0
  fi

  "$py" -m pip install --upgrade pip >/dev/null 2>&1 || true
  if "$py" -m pip install kimi-cli; then
    if [ -x "${venv}/bin/kimi" ]; then
      echo "Kimi CLI installed to ${venv}/bin/kimi"
    else
      echo "Kimi CLI installed, but entrypoint not found at ${venv}/bin/kimi"
    fi
  else
    echo "Kimi CLI install failed; skipping"
  fi
}

install_opencode_release() {
  echo "Installing openCode CLI (optional)..."
  if [ "$SKIP_OPTIONAL_TOOLS" = "1" ]; then
    echo "SKIP_OPTIONAL_TOOLS=1 set; skipping openCode install"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not available; skipping openCode install"
    return 0
  fi

  local raw_os os arch archive_ext filename url tmp_dir tmp_file extracted target_path
  raw_os=$(uname -s)
  os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
  case "$raw_os" in
    Darwin*) os="darwin" ;;
    Linux*) os="linux" ;;
    *) echo "Unsupported OS for openCode installer: ${raw_os}; skipping"; return 0 ;;
  esac

  arch=$(uname -m)
  if [ "$arch" = "aarch64" ]; then
    arch="arm64"
  fi
  if [ "$arch" = "x86_64" ]; then
    arch="x64"
  fi

  archive_ext=".zip"
  if [ "$os" = "linux" ]; then
    archive_ext=".tar.gz"
  fi

  filename="opencode-${os}-${arch}${archive_ext}"
  url="https://github.com/anomalyco/opencode/releases/latest/download/${filename}"

  tmp_dir=$(mktemp -d)
  tmp_file="${tmp_dir}/${filename}"

  echo "Downloading openCode (${filename})..."
  if ! curl -fL "$url" -o "$tmp_file"; then
    echo "openCode download failed; skipping"
    rm -rf "$tmp_dir" >/dev/null 2>&1 || true
    return 0
  fi

  if [ "$os" = "linux" ]; then
    if ! command -v tar >/dev/null 2>&1; then
      echo "tar not available; skipping openCode install"
      rm -rf "$tmp_dir" >/dev/null 2>&1 || true
      return 0
    fi
    tar -xzf "$tmp_file" -C "$tmp_dir"
  else
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip not available; skipping openCode install"
      rm -rf "$tmp_dir" >/dev/null 2>&1 || true
      return 0
    fi
    unzip -q "$tmp_file" -d "$tmp_dir"
  fi

  extracted=$(find "$tmp_dir" -maxdepth 4 -type f -name opencode -print -quit 2>/dev/null || true)
  if [ -z "$extracted" ]; then
    echo "openCode binary not found in archive; skipping"
    rm -rf "$tmp_dir" >/dev/null 2>&1 || true
    return 0
  fi

  target_path="./bin/opencode"
  if [ "$os" = "darwin" ]; then
    target_path="./bin/opencode-darwin"
  fi

  cp "$extracted" "$target_path"
  chmod +x "$target_path" || true
  echo "openCode CLI installed to ${target_path}"

  rm -rf "$tmp_dir" >/dev/null 2>&1 || true
  return 0
}

install_kimi_cli
install_opencode_release

echo "Build completed."
