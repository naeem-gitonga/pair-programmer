import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const logDir = join(homedir(), ".pair-programmer");
const logFile = join(logDir, "pair-programmer.log");

mkdirSync(logDir, { recursive: true });

function write(level: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  let line = `[${ts}] ${level}: ${msg}`;
  if (extra !== undefined) {
    if (extra instanceof Error) {
      line += `\n  ${extra.stack ?? extra.message}`;
    } else {
      try { line += `\n  ${JSON.stringify(extra)}`; } catch { line += `\n  ${String(extra)}`; }
    }
  }
  appendFileSync(logFile, line + "\n");
}

export const log = {
  info:  (msg: string, extra?: unknown) => write("INFO",  msg, extra),
  warn:  (msg: string, extra?: unknown) => write("WARN",  msg, extra),
  error: (msg: string, extra?: unknown) => write("ERROR", msg, extra),
  file: logFile,
  dir: logDir,
};
