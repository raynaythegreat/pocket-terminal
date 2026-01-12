#!/bin/bash
# Build script for Render - installs dependencies including GitHub CLI

set -e

echo "Installing GitHub CLI..."
# Download and install gh CLI
GH_VERSION="2.45.0"
curl -sSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o gh.tar.gz
tar -xzf gh.tar.gz
mkdir -p ./bin
mv gh_${GH_VERSION}_linux_amd64/bin/gh ./bin/
rm -rf gh.tar.gz gh_${GH_VERSION}_linux_amd64
echo "GitHub CLI installed to ./bin/gh"

echo "Installing npm dependencies..."
npm install

echo "Build complete!"
