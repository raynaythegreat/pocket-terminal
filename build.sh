#!/bin/bash
# Build script for Pocket Terminal

echo "--- Building Pocket Terminal ---"

# Ensure directories exist
mkdir -p workspace/projects
mkdir -p workspace/cli-home

# Set permissions for scripts
chmod +x kimi opencode build.sh

# Install dependencies
npm install

echo "--- Build Complete ---"