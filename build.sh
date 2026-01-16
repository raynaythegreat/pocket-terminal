#!/bin/bash
set -e

echo "🔧 Installing CLI tools for Pocket Terminal..."

# Create bin directory
mkdir -p ./bin

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to download and extract GitHub CLI
install_github_cli() {
    echo "📦 Installing GitHub CLI..."
    
    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) GH_ARCH="amd64" ;;
        aarch64|arm64) GH_ARCH="arm64" ;;
        *) echo "❌ Unsupported architecture: $ARCH"; return 1 ;;
    esac
    
    # Get latest release info
    GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4 | sed 's/^v//')
    
    if [ -z "$GH_VERSION" ]; then
        echo "❌ Failed to get GitHub CLI version"
        return 1
    fi
    
    echo "📥 Downloading GitHub CLI v$GH_VERSION..."
    
    # Download based on OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_macOS_${GH_ARCH}.tar.gz"
    else
        GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"
    fi
    
    curl -sL "$GH_URL" | tar -xz -C ./bin --strip-components=2 "*/bin/gh"
    chmod +x ./bin/gh
    echo "✅ GitHub CLI installed successfully"
}

# Function to install GitHub Copilot CLI
install_copilot_cli() {
    echo "📦 Installing GitHub Copilot CLI..."
    
    if ! command_exists npm; then
        echo "❌ npm is required for GitHub Copilot CLI installation"
        return 1
    fi
    
    # Install copilot CLI globally in local directory
    export PREFIX="$(pwd)"
    npm install -g --prefix="$(pwd)" @githubnext/github-copilot-cli
    
    # Create symlink in bin directory
    ln -sf "$(pwd)/lib/node_modules/@githubnext/github-copilot-cli/dist/index.js" ./bin/copilot
    chmod +x ./bin/copilot
    
    echo "✅ GitHub Copilot CLI installed successfully"
}

# Function to install openCode CLI
install_opencode() {
    echo "📦 Installing openCode CLI..."
    
    if [ ! -f "./opencode" ]; then
        echo "❌ opencode binary not found in project root"
        return 1
    fi
    
    cp ./opencode ./bin/opencode
    chmod +x ./bin/opencode
    echo "✅ openCode CLI installed successfully"
}

# Function to install Kimi CLI
install_kimi() {
    echo "📦 Installing Kimi CLI..."
    
    if ! command_exists python3; then
        echo "⚠️  Python 3 not found, skipping Kimi CLI installation"
        return 0
    fi
    
    # Create virtual environment for Kimi
    python3 -m venv ./kimi-cli-deps
    source ./kimi-cli-deps/bin/activate
    
    # Install Kimi CLI dependencies
    pip install --upgrade pip
    pip install anthropic openai requests rich click
    
    # Copy Kimi CLI script
    if [ -f "./kimi" ]; then
        cp ./kimi ./bin/kimi
        chmod +x ./bin/kimi
        echo "✅ Kimi CLI installed successfully"
    else
        echo "❌ kimi script not found in project root"
        deactivate
        return 1
    fi
    
    deactivate
}

# Function to setup CLI environment
setup_cli_environment() {
    echo "🔧 Setting up CLI environment..."
    
    # Create CLI config directories
    mkdir -p ./workspace/cli-home/.config/gh
    mkdir -p ./workspace/cli-home/.config/copilot
    
    # Create shared environment script
    cat > ./bin/cli-env.sh << 'EOF'
#!/bin/bash
# Shared CLI environment for cross-CLI interoperability

# Set up paths
export CLI_HOME="$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")/workspace/cli-home"
export PATH="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")"):$PATH"

# GitHub CLI configuration
export GH_CONFIG_DIR="$CLI_HOME/.config/gh"

# Copilot CLI configuration
export COPILOT_CONFIG_DIR="$CLI_HOME/.config/copilot"

# Enable CLI cross-access
export GH_TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"
export COPILOT_API_KEY="${GITHUB_TOKEN:-$GH_TOKEN}"

# Kimi CLI environment
if [ -f "$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")/kimi-cli-deps/bin/activate" ]; then
    source "$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")/kimi-cli-deps/bin/activate"
fi
EOF
    
    chmod +x ./bin/cli-env.sh
    echo "✅ CLI environment setup complete"
}

# Main installation process
main() {
    echo "🚀 Starting CLI installation process..."
    
    # Install each CLI tool
    install_github_cli || echo "⚠️  GitHub CLI installation failed"
    install_copilot_cli || echo "⚠️  Copilot CLI installation failed"
    install_opencode || echo "⚠️  openCode CLI installation failed"
    install_kimi || echo "⚠️  Kimi CLI installation failed"
    
    # Setup shared environment
    setup_cli_environment
    
    echo ""
    echo "📋 Installation Summary:"
    echo "========================"
    
    if [ -x "./bin/gh" ]; then
        echo "✅ GitHub CLI: $(./bin/gh --version | head -1)"
    else
        echo "❌ GitHub CLI: Not installed"
    fi
    
    if [ -x "./bin/copilot" ]; then
        echo "✅ Copilot CLI: Installed"
    else
        echo "❌ Copilot CLI: Not installed"
    fi
    
    if [ -x "./bin/opencode" ]; then
        echo "✅ openCode CLI: Installed"
    else
        echo "❌ openCode CLI: Not installed"
    fi
    
    if [ -x "./bin/kimi" ]; then
        echo "✅ Kimi CLI: Installed"
    else
        echo "❌ Kimi CLI: Not installed"
    fi
    
    echo ""
    echo "🎉 CLI installation complete!"
    echo "💡 Tip: Set GITHUB_TOKEN environment variable for GitHub CLI and Copilot authentication"
}

# Run main function
main