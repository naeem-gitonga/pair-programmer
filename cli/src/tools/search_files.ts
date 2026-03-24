import { execSync } from "child_process";

const HAS_RIPGREP = (() => { try { execSync("which rg", { stdio: "pipe" }); return true; } catch { return false; } })();

export const search_files_definition = {
  type: "function",
  function: {
    name: "search_files",
    description: "Search file contents for a regex pattern using ripgrep.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search in (default: .)" },
        file_glob: { type: "string", description: "Limit search to files matching this glob (e.g. '*.ts')" },
      },
      required: ["pattern"],
    },
  },
} as const;

export function searchFiles({ pattern, path, file_glob }: ToolArgs): string {
  const target = path ?? ".";
  try {
    if (HAS_RIPGREP) {
      const globFlag = file_glob ? `--glob '${file_glob}'` : "";
      return execSync(`rg --no-heading -n ${globFlag} --iglob '!node_modules' '${pattern}' ${target}`, { encoding: "utf-8", timeout: 15_000 }) || "(no matches)";
    } else {
      const includeFlag = file_glob ? `--include='${file_glob}'` : "";
      return execSync(`grep -rn ${includeFlag} --exclude-dir=node_modules '${pattern}' ${target}`, { encoding: "utf-8", timeout: 15_000 }) || "(no matches)";
    }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (e.status === 1) return "(no matches)";
    return e.stderr ?? "Error running search";
  }
}
