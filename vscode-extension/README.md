# Pair Programmer Context — VS Code Extension

Tracks your active file and selection and writes context to `~/.pair-programmer/context.json` so the pair programmer CLI knows what you're looking at.

## Development

Open the `vscode-extension/` folder in VS Code and press `F5`. This compiles the extension and launches an Extension Development Host — a second VS Code window with the extension loaded.

## Install

**1. Install dependencies and compile:**
```bash
cd vscode-extension
npm install
npm run compile
```

**2. Package into a `.vsix` file:**
```bash
npx vsce package
```

**3. Install into VS Code:**
```bash
code --install-extension pair-programmer-context-0.0.1.vsix
```

After installation the extension loads automatically every time VS Code starts. No configuration needed.
