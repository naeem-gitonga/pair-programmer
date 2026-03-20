import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONTEXT_FILE = path.join(os.homedir(), ".pair-programmer", "context.json");

function writeContext(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

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

export function activate(context: vscode.ExtensionContext): void {
  writeContext();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => writeContext()),
    vscode.window.onDidChangeTextEditorSelection(() => writeContext()),
  );
}

export function deactivate(): void {}
