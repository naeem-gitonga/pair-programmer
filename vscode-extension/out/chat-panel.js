"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const path = require("path");
const APPROVAL_PROMPT = "Apply changes? [y/N]";
function stripAnsi(str) {
    return str
        .replace(/\x1b\[[0-9;]*[mGKHFJsuABCDlhfSTrn]/g, "")
        .replace(/\x1b[()][AB012]/g, "")
        .replace(/\x1b[ABCDEFGHJKST]/g, "")
        .replace(/\x07/g, "")
        .replace(/\x1b\[\?25[lh]/g, ""); // show/hide cursor
}
function classifyLine(line) {
    if (/^\[tool\]/.test(line))
        return "tool";
    if (/^Assistant:/.test(line))
        return "assistant-header";
    if (/^Error:/.test(line))
        return "error";
    return "system";
}
class ChatPanel {
    constructor(extensionUri) {
        this.cli = null;
        this.disposeCallbacks = [];
        this.stdoutBuf = "";
        this.flushTimer = null;
        this.pendingLines = [];
        this.currentAssistantLines = [];
        this.panel = vscode.window.createWebviewPanel("pairProgrammerChat", "Pair Programmer", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.html = this.getHtml();
        this.startCli(extensionUri);
        this.panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === "send" && this.cli?.stdin) {
                this.cli.stdin.write(msg.text + "\n");
            }
        });
        this.panel.onDidDispose(() => {
            this.cli?.kill();
            this.disposeCallbacks.forEach((cb) => cb());
        });
    }
    startCli(extensionUri) {
        const projectRoot = path.join(extensionUri.fsPath, "..");
        const cliEntry = path.join(projectRoot, "cli", "src", "main.ts");
        const tsx = path.join(projectRoot, "cli", "node_modules", ".bin", "tsx");
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? projectRoot;
        this.cli = (0, child_process_1.spawn)(tsx, ["--no-deprecation", cliEntry], {
            cwd,
            env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.cli.stdout?.on("data", (chunk) => {
            this.stdoutBuf += chunk.toString();
            const lines = this.stdoutBuf.split("\n");
            this.stdoutBuf = lines.pop() ?? "";
            for (const line of lines) {
                this.handleLine(line);
            }
        });
        this.cli.stdout?.on("end", () => {
            if (this.stdoutBuf.trim())
                this.handleLine(this.stdoutBuf);
        });
        this.cli.stderr?.on("data", (chunk) => {
            const text = stripAnsi(chunk.toString()).trim();
            if (text)
                this.post({ type: "line", text, cls: "error" });
        });
        this.cli.on("exit", (code) => {
            this.post({ type: "line", text: `[CLI exited with code ${code}]`, cls: "error" });
        });
    }
    handleLine(raw) {
        // Skip readline prompts
        if (/^You:\s*$/.test(raw.trim()))
            return;
        // Detect file approval prompt
        if (raw.includes(APPROVAL_PROMPT)) {
            this.showApproval();
            return;
        }
        const text = stripAnsi(raw).trim();
        if (!text)
            return;
        const cls = classifyLine(text);
        // Buffer and batch lines with a short delay to group related output
        this.pendingLines.push({ text, cls });
        if (this.flushTimer)
            clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => {
            const batch = this.pendingLines.splice(0);
            if (batch.length) {
                this.post({ type: "batch", lines: batch });
            }
        }, 40);
    }
    async showApproval() {
        const choice = await vscode.window.showInformationMessage("The AI wants to write a file. Apply changes?", { modal: true }, "Apply", "Decline");
        this.cli?.stdin?.write(choice === "Apply" ? "y\n" : "n\n");
    }
    post(msg) {
        this.panel.webview.postMessage(msg);
    }
    reveal() {
        this.panel.reveal();
    }
    onDispose(cb) {
        this.disposeCallbacks.push(cb);
    }
    getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  display: flex; flex-direction: column; height: 100vh;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}
#messages {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 4px;
}
.bubble {
  max-width: 85%; padding: 8px 12px; border-radius: 8px;
  white-space: pre-wrap; word-break: break-word; line-height: 1.5;
}
.bubble.user {
  align-self: flex-end;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-radius: 8px 8px 2px 8px;
}
.line { white-space: pre-wrap; word-break: break-word; line-height: 1.6; padding: 1px 0; }
.line.assistant-header { color: var(--vscode-terminal-ansiCyan); font-weight: bold; margin-top: 6px; }
.line.tool { color: var(--vscode-terminal-ansiYellow); font-size: 0.88em; font-family: var(--vscode-editor-font-family); }
.line.error { color: var(--vscode-terminal-ansiRed); }
.line.system { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
#bottom {
  display: flex; gap: 8px; padding: 10px 12px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}
#input {
  flex: 1;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: 6px; padding: 8px 10px;
  font-family: inherit; font-size: inherit;
  resize: none; min-height: 56px; max-height: 200px;
  line-height: 1.5;
}
#input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
#send-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none; border-radius: 6px;
  padding: 0 16px; cursor: pointer;
  align-self: flex-end; height: 36px;
  font-family: inherit; font-size: inherit;
}
#send-btn:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<div id="messages"></div>
<div id="bottom">
  <textarea id="input" placeholder="Message... (Enter to send, Shift+Enter for newline)"></textarea>
  <button id="send-btn">Send</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const msgs = document.getElementById('messages');
const input = document.getElementById('input');
const btn = document.getElementById('send-btn');

function appendBubble(text, cls) {
  const div = document.createElement('div');
  div.className = 'bubble ' + cls;
  div.textContent = text;
  msgs.appendChild(div);
}

function appendLine(text, cls) {
  const div = document.createElement('div');
  div.className = 'line ' + cls;
  div.textContent = text;
  msgs.appendChild(div);
}

function scrollBottom() {
  msgs.scrollTop = msgs.scrollHeight;
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  appendBubble(text, 'user');
  scrollBottom();
  vscode.postMessage({ type: 'send', text });
  input.value = '';
  input.style.height = 'auto';
}

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
  setTimeout(() => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });
});

btn.addEventListener('click', send);

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'line') {
    appendLine(msg.text, msg.cls || 'system');
    scrollBottom();
  } else if (msg.type === 'batch') {
    for (const { text, cls } of msg.lines) {
      appendLine(text, cls || 'system');
    }
    scrollBottom();
  }
});
</script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
//# sourceMappingURL=chat-panel.js.map