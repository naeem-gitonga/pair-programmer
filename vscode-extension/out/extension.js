"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const CONTEXT_FILE = path.join(os.homedir(), ".pair-programmer", "context.json");
function writeContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    const doc = editor.document;
    const selection = editor.selection;
    const context = {
        file: doc.fileName,
        language: doc.languageId,
        line: selection.active.line + 1,
        selection: selection.isEmpty ? null : doc.getText(selection),
    };
    fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    fs.writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));
}
function activate(context) {
    writeContext();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => writeContext()), vscode.window.onDidChangeTextEditorSelection(() => writeContext()));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map