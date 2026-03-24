import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir, homedir } from "os";
import { join, basename } from "path";
import { execSync } from "child_process";
import chalk from "chalk";

const CLOSE_SIGNAL = join(homedir(), ".pair-programmer", "close-editors.json");

function writeCloseSignal(paths: string[]): void {
  try { writeFileSync(CLOSE_SIGNAL, JSON.stringify(paths)); } catch { /* ignore */ }
}

const hasVSCode = (() => {
  try { execSync("which code", { stdio: "pipe" }); return true; } catch { return false; }
})();

export function openVSCodeDiff(filePath: string, newContent: string): void {
  const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const tmpOld = join(tmpdir(), `pair-prog-old-${basename(filePath)}`);
  const tmpNew = join(tmpdir(), `pair-prog-new-${basename(filePath)}`);
  writeFileSync(tmpOld, oldContent);
  writeFileSync(tmpNew, newContent);
  execSync(`code --diff "${tmpOld}" "${tmpNew}"`, { stdio: "ignore" });
}

export function isVSCodeAvailable(): boolean {
  return hasVSCode;
}

// Returns null if VS Code is unavailable (caller should fall back to terminal diff).
// Returns true/false for approved/declined when VS Code diff was shown.
export async function approveWriteFileVSCode(
  filePath: string,
  newContent: string,
  readKey: (prompt: string) => Promise<string>,
  onPause?: () => void,
  onResume?: () => void,
): Promise<boolean | null> {
  if (!hasVSCode) return null;

  try {
    openVSCodeDiff(filePath, newContent);
    process.stdout.write(chalk.bold(`\n─── ${filePath} ───\n`));
    process.stdout.write(chalk.gray("Opened diff in Visual Studio Code ⧉\n"));
  } catch {
    return null; // fall back to terminal diff
  }

  onPause?.();
  const key = await readKey(chalk.bold("\nApply changes? [y/N] "));
  onResume?.();

  // Signal the VS Code extension to close the diff editors, then delete the tmp files.
  const tmpOld = join(tmpdir(), `pair-prog-old-${basename(filePath)}`);
  const tmpNew = join(tmpdir(), `pair-prog-new-${basename(filePath)}`);
  writeCloseSignal([tmpOld, tmpNew]);
  await new Promise((r) => setTimeout(r, 300)); // give extension time to react
  try { unlinkSync(tmpOld); } catch { /* ignore */ }
  try { unlinkSync(tmpNew); } catch { /* ignore */ }

  return key === "y";
}
