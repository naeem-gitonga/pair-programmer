import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".pair-programmer");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface AppConfig {
  localServerUrl?: string;
}

export function readAppConfig(): AppConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function writeAppConfig(updates: Partial<AppConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...readAppConfig(), ...updates }, null, 2));
}
