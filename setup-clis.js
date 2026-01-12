const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Setting up AI CLI tools...');

// Create bin directory for CLI symlinks
const binDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// List of CLIs to set up
const clis = [
  { name: 'claude', package: '@anthropic-ai/claude-code', bin: 'claude' },
  { name: 'gemini', package: '@google/gemini-cli', bin: 'gemini' },
  { name: 'codex', package: '@openai/codex', bin: 'codex' }
];

clis.forEach(cli => {
  try {
    const modulePath = path.join(__dirname, 'node_modules', cli.package);
    if (fs.existsSync(modulePath)) {
      console.log(`${cli.name} CLI installed successfully`);
    }
  } catch (err) {
    console.log(`Note: ${cli.name} may need manual setup`);
  }
});

console.log('\nAI CLI setup complete!');
console.log('Available commands: claude, gemini, codex');
console.log('\nMake sure to set your API keys in environment variables:');
console.log('  ANTHROPIC_API_KEY - for Claude');
console.log('  GOOGLE_API_KEY or GEMINI_API_KEY - for Gemini');
console.log('  OPENAI_API_KEY - for Codex');
