#!/usr/bin/env bash
set -e

echo "Installing npm dependencies..."
npm ci

# Ensure local CLI scripts are executable
if [ -f "kimi" ]; then
  chmod +x kimi
fi
if [ -f "opencode" ]; then
  chmod +x opencode
fi

echo "Build complete."