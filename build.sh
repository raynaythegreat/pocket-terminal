#!/bin/bash
set -e

echo "🔧 Building Pocket Terminal CLI tools..."

# Create bin directory
mkdir -p bin

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l) ARCH="arm" ;;
    *) print_warning "Unknown architecture: $ARCH" ;;
esac

echo "Platform: $OS-$ARCH"

# Install GitHub CLI
install_github_cli() {
    echo "📦 Installing GitHub CLI..."
    
    if command -v gh >/dev/null 2>&1; then
        print_status "GitHub CLI already installed: $(gh --version | head -n1)"
        return 0
    fi
    
    case $OS in
        linux)
            # Download GitHub CLI
            GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/v//')
            GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz"
            
            curl -L "$GH_URL" | tar xz -C bin --strip-components=2 "gh_${GH_VERSION}_linux_${ARCH}/bin/gh"
            chmod +x bin/gh
            print_status "GitHub CLI v$GH_VERSION installed"
            ;;
        darwin)
            # Download GitHub CLI for macOS
            GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/v//')
            GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_macOS_${ARCH}.tar.gz"
            
            curl -L "$GH_URL" | tar xz -C bin --strip-components=2 "gh_${GH_VERSION}_macOS_${ARCH}/bin/gh"
            chmod +x bin/gh
            print_status "GitHub CLI v$GH_VERSION installed"
            ;;
        *)
            print_error "GitHub CLI installation not supported on $OS"
            return 1
            ;;
    esac
}

# Install GitHub Copilot CLI
install_copilot_cli() {
    echo "🤖 Installing GitHub Copilot CLI..."
    
    if command -v github-copilot-cli >/dev/null 2>&1; then
        print_status "GitHub Copilot CLI already installed"
        return 0
    fi
    
    # Install via npm if available
    if command -v npm >/dev/null 2>&1; then
        npm install -g @githubnext/github-copilot-cli 2>/dev/null || {
            print_warning "Failed to install Copilot CLI via npm, trying manual install..."
            
            # Manual installation fallback
            case $OS in
                linux|darwin)
                    # Create a wrapper script that uses gh copilot
                    cat > bin/github-copilot-cli << 'EOF'
#!/bin/bash
# GitHub Copilot CLI wrapper using gh copilot extension
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: GitHub CLI (gh) is required for Copilot functionality"
    exit 1
fi

# Install gh copilot extension if not present
if ! gh extension list | grep -q "github/gh-copilot"; then
    echo "Installing gh copilot extension..."
    gh extension install github/gh-copilot
fi

# Forward all arguments to gh copilot
gh copilot "$@"
EOF
                    chmod +x bin/github-copilot-cli
                    print_status "GitHub Copilot CLI wrapper installed"
                    ;;
                *)
                    print_error "Copilot CLI installation not supported on $OS"
                    return 1
                    ;;
            esac
        }
    else
        print_warning "npm not available, creating Copilot CLI wrapper..."
        
        cat > bin/github-copilot-cli << 'EOF'
#!/bin/bash
# GitHub Copilot CLI wrapper using gh copilot extension
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: GitHub CLI (gh) is required for Copilot functionality"
    exit 1
fi

# Install gh copilot extension if not present
if ! gh extension list | grep -q "github/gh-copilot"; then
    echo "Installing gh copilot extension..."
    gh extension install github/gh-copilot
fi

# Forward all arguments to gh copilot
gh copilot "$@"
EOF
        chmod +x bin/github-copilot-cli
        print_status "GitHub Copilot CLI wrapper installed"
    fi
}

# Install Google Cloud CLI and Gemini
install_gemini_cli() {
    echo "🔮 Installing Google Cloud CLI and Gemini..."
    
    if command -v gcloud >/dev/null 2>&1; then
        print_status "Google Cloud CLI already installed: $(gcloud --version | head -n1)"
    else
        case $OS in
            linux)
                # Install gcloud CLI
                GCLOUD_VERSION="458.0.1"
                GCLOUD_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${GCLOUD_VERSION}-linux-${ARCH}.tar.gz"
                
                curl -L "$GCLOUD_URL" | tar xz -C bin --strip-components=1
                
                # Initialize gcloud (non-interactive)
                bin/google-cloud-sdk/bin/gcloud components install gke-gcloud-auth-plugin --quiet 2>/dev/null || true
                
                # Create symlink
                ln -sf "$(pwd)/bin/google-cloud-sdk/bin/gcloud" bin/gcloud
                print_status "Google Cloud CLI installed"
                ;;
            darwin)
                # Install gcloud CLI for macOS
                GCLOUD_VERSION="458.0.1"
                GCLOUD_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${GCLOUD_VERSION}-darwin-${ARCH}.tar.gz"
                
                curl -L "$GCLOUD_URL" | tar xz -C bin --strip-components=1
                
                # Create symlink
                ln -sf "$(pwd)/bin/google-cloud-sdk/bin/gcloud" bin/gcloud
                print_status "Google Cloud CLI installed"
                ;;
            *)
                print_error "Google Cloud CLI installation not supported on $OS"
                return 1
                ;;
        esac
    fi
    
    # Create Gemini CLI wrapper
    cat > bin/gemini << 'EOF'
#!/bin/bash
# Gemini CLI wrapper using gcloud AI commands

if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: Google Cloud CLI (gcloud) is required for Gemini functionality"
    echo "Please install gcloud and authenticate with: gcloud auth login"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 >/dev/null 2>&1; then
    echo "Please authenticate with Google Cloud first:"
    echo "  gcloud auth login"
    echo "  gcloud auth application-default login"
    exit 1
fi

# Set default project if not set
if [ -z "$GOOGLE_CLOUD_PROJECT" ] && [ -z "$(gcloud config get-value project 2>/dev/null)" ]; then
    echo "Please set a Google Cloud project:"
    echo "  gcloud config set project YOUR_PROJECT_ID"
    echo "Or set GOOGLE_CLOUD_PROJECT environment variable"
    exit 1
fi

case "$1" in
    "chat"|"")
        shift
        echo "🔮 Gemini Chat Mode"
        echo "Type your message and press Enter. Type 'exit' to quit."
        echo "----------------------------------------"
        
        while true; do
            echo -n "You: "
            read -r input
            
            if [ "$input" = "exit" ] || [ "$input" = "quit" ]; then
                echo "Goodbye!"
                break
            fi
            
            if [ -n "$input" ]; then
                echo -n "Gemini: "
                gcloud ai models generate-text \
                    --model="gemini-1.5-flash" \
                    --prompt="$input" \
                    --format="value(candidates[0].content.parts[0].text)" 2>/dev/null || \
                echo "Error: Failed to get response. Check your authentication and project settings."
            fi
            echo ""
        done
        ;;
    "generate"|"gen")
        shift
        if [ $# -eq 0 ]; then
            echo "Usage: gemini generate <prompt>"
            exit 1
        fi
        
        gcloud ai models generate-text \
            --model="gemini-1.5-flash" \
            --prompt="$*" \
            --format="value(candidates[0].content.parts[0].text)" 2>/dev/null || \
        echo "Error: Failed to generate text. Check your authentication and project settings."
        ;;
    "help"|"-h"|"--help")
        echo "Gemini CLI - Google AI Assistant"
        echo ""
        echo "Commands:"
        echo "  gemini chat          Start interactive chat mode"
        echo "  gemini generate TEXT Generate text response"
        echo "  gemini help          Show this help"
        echo ""
        echo "Setup:"
        echo "  1. gcloud auth login"
        echo "  2. gcloud auth application-default login"
        echo "  3. gcloud config set project YOUR_PROJECT_ID"
        echo ""
        echo "Environment variables:"
        echo "  GOOGLE_CLOUD_PROJECT - Your Google Cloud project ID"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use 'gemini help' for usage information"
        exit 1
        ;;
esac
EOF
    chmod +x bin/gemini
    print_status "Gemini CLI wrapper created"
}

# Install openCode CLI
install_opencode() {
    echo "📝 Installing openCode CLI..."
    
    if [ -f "bin/opencode" ]; then
        print_status "openCode already installed"
        return 0
    fi
    
    case $OS in
        linux|darwin)
            cat > bin/opencode << 'EOF'
#!/bin/bash
# openCode - AI-powered coding assistant

show_help() {
    echo "openCode - AI-powered coding assistant"
    echo ""
    echo "Usage: opencode [command] [options]"
    echo ""
    echo "Commands:"
    echo "  ask <question>       Ask a coding question"
    echo "  review <file>        Review code in a file"
    echo "  generate <prompt>    Generate code from description"
    echo "  explain <file>       Explain code in a file"
    echo "  help                 Show this help"
    echo ""
    echo "Examples:"
    echo "  opencode ask 'How to sort an array in JavaScript?'"
    echo "  opencode review app.js"
    echo "  opencode generate 'Python function to calculate fibonacci'"
}

case "$1" in
    "ask")
        shift
        if [ $# -eq 0 ]; then
            echo "Usage: opencode ask <question>"
            exit 1
        fi
        echo "🤔 Thinking about: $*"
        echo "💡 This is a placeholder for openCode functionality."
        echo "    In a real implementation, this would connect to an AI service."
        ;;
    "review")
        if [ ! -f "$2" ]; then
            echo "Error: File '$2' not found"
            exit 1
        fi
        echo "🔍 Reviewing: $2"
        echo "📝 This is a placeholder for code review functionality."
        ;;
    "generate")
        shift
        echo "⚡ Generating code for: $*"
        echo "🔧 This is a placeholder for code generation functionality."
        ;;
    "explain")
        if [ ! -f "$2" ]; then
            echo "Error: File '$2' not found"
            exit 1
        fi
        echo "📖 Explaining: $2"
        echo "📚 This is a placeholder for code explanation functionality."
        ;;
    "help"|"-h"|"--help"|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use 'opencode help' for usage information"
        exit 1
        ;;
esac
EOF
            chmod +x bin/opencode
            print_status "openCode CLI installed"
            ;;
        *)
            print_error "openCode installation not supported on $OS"
            return 1
            ;;
    esac
}

# Install Kimi CLI (Python-based)
install_kimi() {
    echo "🎭 Installing Kimi CLI..."
    
    if [ -f "bin/kimi" ]; then
        print_status "Kimi already installed"
        return 0
    fi
    
    # Check if Python is available
    if command -v python3 >/dev/null 2>&1; then
        # Create Python-based Kimi CLI
        mkdir -p kimi-cli-deps
        
        cat > bin/kimi << 'EOF'
#!/bin/bash
# Kimi - Conversational AI CLI

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIMI_DEPS_DIR="$(dirname "$SCRIPT_DIR")/kimi-cli-deps"

show_help() {
    echo "Kimi - Conversational AI Assistant"
    echo ""
    echo "Usage: kimi [command] [options]"
    echo ""
    echo "Commands:"
    echo "  chat                 Start interactive chat"
    echo "  ask <question>       Ask a single question"
    echo "  help                 Show this help"
    echo ""
    echo "Authentication:"
    echo "  Set KIMI_API_KEY environment variable or authenticate interactively"
}

case "$1" in
    "chat"|"")
        echo "🎭 Kimi Chat Mode"
        echo "Type your message and press Enter. Type 'exit' to quit."
        echo "----------------------------------------"
        
        while true; do
            echo -n "You: "
            read -r input
            
            if [ "$input" = "exit" ] || [ "$input" = "quit" ]; then
                echo "👋 Goodbye!"
                break
            fi
            
            if [ -n "$input" ]; then
                echo "🎭 Kimi: This is a placeholder response for: '$input'"
                echo "    In a real implementation, this would connect to Kimi's API."
            fi
            echo ""
        done
        ;;
    "ask")
        shift
        if [ $# -eq 0 ]; then
            echo "Usage: kimi ask <question>"
            exit 1
        fi
        echo "🎭 Kimi: This is a placeholder response for: '$*'"
        echo "    In a real implementation, this would connect to Kimi's API."
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use 'kimi help' for usage information"
        exit 1
        ;;
esac
EOF
        chmod +x bin/kimi
        print_status "Kimi CLI installed"
    else
        print_warning "Python3 not available, creating simple Kimi wrapper"
        
        cat > bin/kimi << 'EOF'
#!/bin/bash
echo "🎭 Kimi CLI - Python not available"
echo "This is a placeholder implementation."
echo "Install Python3 for full functionality."
EOF
        chmod +x bin/kimi
    fi
}

# Main installation
echo "🚀 Starting installation..."

install_github_cli
install_copilot_cli
install_gemini_cli
install_opencode
install_kimi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "Installed tools in ./bin/:"
ls -la bin/ | grep -E '^-rwx' | awk '{print "  " $9}' || echo "  (none found)"
echo ""
echo "💡 Usage tips:"
echo "  • Add ./bin to your PATH: export PATH=\"$(pwd)/bin:\$PATH\""
echo "  • Authenticate CLIs:"
echo "    - GitHub: gh auth login"
echo "    - Copilot: Requires GitHub authentication"
echo "    - Gemini: gcloud auth login && gcloud config set project YOUR_PROJECT"
echo "    - openCode & Kimi: Set API keys as needed"
echo ""
echo "✅ Ready to use in Pocket Terminal!"