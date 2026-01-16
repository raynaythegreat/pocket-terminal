#!/bin/bash
set -e

# Pocket Terminal Build Script
# This script installs optional tools and dependencies.

mkdir -p bin

# 1. Install Node dependencies
npm install

# 2. Install Google Cloud SDK (needed for Gemini CLI Google account login)
if [ ! -d "bin/google-cloud-sdk" ]; then
  echo "Installing Google Cloud SDK..."
  curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
  tar -xf google-cloud-cli-linux-x86_64.tar.gz -C bin/
  ./bin/google-cloud-sdk/install.sh --quiet --usage-reporting=false --path-update=false
  # Create a symlink in the bin directory for easy resolution
  ln -sf ./google-cloud-sdk/bin/gcloud bin/gcloud
  rm google-cloud-cli-linux-x86_64.tar.gz
  echo "Google Cloud SDK installed."
else
  echo "Google Cloud SDK already present."
fi

# 3. Add other tool binaries if needed
# Example: Kimi CLI or others
if [ -f "kimi" ]; then
  chmod +x kimi
  ln -sf ../kimi bin/kimi
fi

if [ -f "opencode" ]; then
  chmod +x opencode
  ln -sf ../opencode bin/opencode
fi

echo "Build complete. Binaries available in ./bin"