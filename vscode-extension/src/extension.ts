import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SIGNAL_DIR   = path.join(os.homedir(), ".pair-programmer");
const CONTEXT_FILE = path.join(SIGNAL_DIR, "context.json");
const OPEN_SIGNAL  = path.join(SIGNAL_DIR, "open-diff.json");
const CLOSE_SIGNAL = path.join(SIGNAL_DIR, "close-editors.json");

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

async function closeEditorsByPath(paths: string[]): Promise<void> {
  const toClose = new Set(paths.map((p) => p.toLowerCase()));
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (toClose.has(input.uri.fsPath.toLowerCase())) {
          await vscode.window.tabGroups.close(tab);
        }
      } else if (input instanceof vscode.TabInputTextDiff) {
        if (
          toClose.has(input.original.fsPath.toLowerCase()) ||
          toClose.has(input.modified.fsPath.toLowerCase())
        ) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }
}

function watchSignals(context: vscode.ExtensionContext): void {
  fs.mkdirSync(SIGNAL_DIR, { recursive: true });

  const dirUri = vscode.Uri.file(SIGNAL_DIR);

  // Watch for open-diff signal — open diff in VS Code without stealing focus
  const openWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dirUri, path.basename(OPEN_SIGNAL))
  );
  const handleOpen = async () => {
    if (!fs.existsSync(OPEN_SIGNAL)) return;
    try {
      const { old: oldPath, new: newPath, label } = JSON.parse(fs.readFileSync(OPEN_SIGNAL, "utf-8"));
      fs.unlinkSync(OPEN_SIGNAL);
      await vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.file(oldPath),
        vscode.Uri.file(newPath),
        `${label}: original ↔ proposed`,
        { preview: true, preserveFocus: true }
      );
    } catch { /* ignore */ }
  };
  context.subscriptions.push(openWatcher.onDidCreate(handleOpen));
  context.subscriptions.push(openWatcher.onDidChange(handleOpen));
  context.subscriptions.push(openWatcher);

  // Watch for close-editors signal
  const closeWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dirUri, path.basename(CLOSE_SIGNAL))
  );
  const handleClose = async () => {
    if (!fs.existsSync(CLOSE_SIGNAL)) return;
    try {
      const paths: string[] = JSON.parse(fs.readFileSync(CLOSE_SIGNAL, "utf-8"));
      fs.unlinkSync(CLOSE_SIGNAL);
      await closeEditorsByPath(paths);
      await vscode.commands.executeCommand("workbench.action.terminal.focus");
    } catch { /* ignore */ }
  };
  context.subscriptions.push(closeWatcher.onDidCreate(handleClose));
  context.subscriptions.push(closeWatcher.onDidChange(handleClose));
  context.subscriptions.push(closeWatcher);
}

export function activate(context: vscode.ExtensionContext): void {
  writeContext();
  watchSignals(context);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => writeContext()),
    vscode.window.onDidChangeTextEditorSelection(() => writeContext()),
  );
}

export function deactivate(): void {}
