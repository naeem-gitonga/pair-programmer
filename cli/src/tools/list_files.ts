import { execSync } from "child_process";

const HAS_RIPGREP = (() => { try { execSync("which rg", { stdio: "pipe" }); return true; } catch { return false; } })();

export const list_files_definition = {
  type: "function",
  function: {
    name: "list_files",
    description: "Find files matching a glob pattern (e.g. 'src/**/*.ts').",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        cwd: { type: "string", description: "Directory to search from (default: process.cwd())" },
      },
      required: ["pattern"],
    },
  },
} as const;

export function listFiles({ pattern, cwd }: ToolArgs): string {
  const searchDir = cwd ?? process.cwd();
  try {
    if (HAS_RIPGREP) {
      return execSync(`rg --files --glob '${pattern}' --iglob '!node_modules' '${searchDir}'`, { encoding: "utf-8", timeout: 15_000 }).trim() || "(no matches)";
    } else {
      return execSync(`find '${searchDir}' -not -path '*/node_modules/*' -name '${pattern}'`, { encoding: "utf-8", timeout: 15_000 }).trim() || "(no matches)";
    }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return "(no matches)";
    return `Error: ${(err as Error).message}`;
  }
}
