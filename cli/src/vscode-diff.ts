import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from "fs";
import { tmpdir, homedir } from "os";
import { join, basename } from "path";
import chalk from "chalk";

const SIGNAL_DIR = join(homedir(), ".pair-programmer");
const OPEN_SIGNAL  = join(SIGNAL_DIR, "open-diff.json");
const CLOSE_SIGNAL = join(SIGNAL_DIR, "close-editors.json");

function ensureSignalDir(): void {
  mkdirSync(SIGNAL_DIR, { recursive: true });
}

function writeOpenSignal(oldPath: string, newPath: string, label: string): void {
  ensureSignalDir();
  try { writeFileSync(OPEN_SIGNAL, JSON.stringify({ old: oldPath, new: newPath, label })); } catch { /* ignore */ }
}

function writeCloseSignal(paths: string[]): void {
  ensureSignalDir();
  try { writeFileSync(CLOSE_SIGNAL, JSON.stringify(paths)); } catch { /* ignore */ }
}

// Check whether the extension is active by seeing if it has recently written context.json
export function isVSCodeAvailable(): boolean {
  const contextFile = join(SIGNAL_DIR, "context.json");
  if (!existsSync(contextFile)) return false;
  try {
    const { mtimeMs } = statSync(contextFile);
    return Date.now() - mtimeMs < 10 * 60 * 1000;
  } catch { return false; }
}

// Returns null if VS Code extension is unavailable (caller falls back to terminal diff).
// Returns true/false for approved/declined.
export async function approveWriteFileVSCode(
  filePath: string,
  newContent: string,
  readKey: (prompt: string) => Promise<string>,
  onPause?: () => void,
  onResume?: () => void,
): Promise<boolean | null> {
  if (!isVSCodeAvailable()) return null;

  const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const tmpOld = join(tmpdir(), `pair-prog-old-${basename(filePath)}`);
  const tmpNew = join(tmpdir(), `pair-prog-new-${basename(filePath)}`);

  try {
    writeFileSync(tmpOld, oldContent);
    writeFileSync(tmpNew, newContent);
    writeOpenSignal(tmpOld, tmpNew, basename(filePath));
    process.stdout.write(chalk.bold(`\n─── ${filePath} ───\n`));
    process.stdout.write(chalk.gray("Opened diff in Visual Studio Code ⧉\n"));
  } catch {
    return null; // fall back to terminal diff
  }

  onPause?.();
  const key = await readKey(chalk.bold("\nApply changes? [y/N] "));
  onResume?.();

  // Signal the extension to close the diff tabs, then delete tmp files.
  writeCloseSignal([tmpOld, tmpNew]);
  await new Promise((r) => setTimeout(r, 300)); // give extension time to react
  try { unlinkSync(tmpOld); } catch { /* ignore */ }
  try { unlinkSync(tmpNew); } catch { /* ignore */ }

  return key === "y";
}
