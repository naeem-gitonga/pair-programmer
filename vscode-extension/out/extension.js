"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const CONTEXT_FILE = path.join(os.homedir(), ".pair-programmer", "context.json");
const CLOSE_SIGNAL = path.join(os.homedir(), ".pair-programmer", "close-editors.json");
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
async function closeEditorsByPath(paths) {
    const toClose = new Set(paths.map((p) => p.toLowerCase()));
    for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                if (toClose.has(input.uri.fsPath.toLowerCase())) {
                    await vscode.window.tabGroups.close(tab);
                }
            }
            else if (input instanceof vscode.TabInputTextDiff) {
                if (toClose.has(input.original.fsPath.toLowerCase()) ||
                    toClose.has(input.modified.fsPath.toLowerCase())) {
                    await vscode.window.tabGroups.close(tab);
                }
            }
        }
    }
}
function watchCloseSignal(context) {
    const dir = path.dirname(CLOSE_SIGNAL);
    fs.mkdirSync(dir, { recursive: true });
    const watcher = fs.watch(dir, async (_event, filename) => {
        if (filename !== path.basename(CLOSE_SIGNAL))
            return;
        if (!fs.existsSync(CLOSE_SIGNAL))
            return;
        try {
            const paths = JSON.parse(fs.readFileSync(CLOSE_SIGNAL, "utf-8"));
            fs.unlinkSync(CLOSE_SIGNAL);
            await closeEditorsByPath(paths);
        }
        catch { /* ignore */ }
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
}
function activate(context) {
    writeContext();
    watchCloseSignal(context);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => writeContext()), vscode.window.onDidChangeTextEditorSelection(() => writeContext()));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map