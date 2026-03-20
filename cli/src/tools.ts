import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { glob } from "fs/promises";
import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

// ── Web (Tavily) ──────────────────────────────────────────────────────────────

async function web({ input }: ToolArgs): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "Error: TAVILY_API_KEY environment variable is not set.";

  const isUrl = /^https?:\/\//i.test(input);

  try {
    if (isUrl) {
      const res = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, urls: [input] }),
      });
      const data = await res.json() as { results?: { url: string; raw_content: string }[] };
      const result = data.results?.[0];
      if (!result) return "No content extracted.";
      return result.raw_content.slice(0, 8000);
    } else {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: input, search_depth: "basic", max_results: 5 }),
      });
      const data = await res.json() as { results?: { title: string; url: string; content: string }[] };
      if (!data.results?.length) return "No results found.";
      return data.results.map(r => `${r.title}\n${r.url}\n${r.content}`).join("\n\n");
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// ── Tool Definitions (sent to the model) ──────────────────────────────────────

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the given path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, creating it if it does not exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write to" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Execute a shell command and return stdout + stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
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
  },
  {
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
  },
  {
    type: "function",
    function: {
      name: "web",
      description: "Fetch a URL and return its content, or search Google for a query and return results.",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "A URL to fetch or a search query" },
        },
        required: ["input"],
      },
    },
  },
];

// ── Tool Implementations ───────────────────────────────────────────────────────

type ToolArgs = Record<string, string>;

function readFile({ path }: ToolArgs): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

function writeFile({ path, content }: ToolArgs): string {
  try {
    writeFileSync(path, content, "utf-8");
    return `Written ${content.length} bytes to ${path}`;
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

function bash({ command }: ToolArgs): string {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
  }
}

async function listFiles({ pattern, cwd }: ToolArgs): Promise<string> {
  try {
    const matches: string[] = [];
    for await (const file of glob(pattern, { cwd: cwd ?? process.cwd(), exclude: (f) => f.includes("node_modules") })) {
      matches.push(file as string);
    }
    return matches.length > 0 ? matches.join("\n") : "(no matches)";
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

const HAS_RIPGREP = (() => {
  try { execSync("which rg", { stdio: "pipe" }); return true; } catch { return false; }
})();

function searchFiles({ pattern, path, file_glob }: ToolArgs): string {
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

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  switch (name) {
    case "read_file":    return readFile(args);
    case "write_file":   return writeFile(args);
    case "bash":         return bash(args);
    case "list_files":   return await listFiles(args);
    case "search_files": return searchFiles(args);
    case "web":          return await web(args);
    default:             return `Unknown tool: ${name}`;
  }
}
