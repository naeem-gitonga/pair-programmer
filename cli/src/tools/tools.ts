import { readFile, read_file_definition } from "./read_file.js";
import { writeFile, write_file_definition } from "./write_file.js";
import { bash, bash_definition } from "./bash.js";
import { listFiles, list_files_definition } from "./list_files.js";
import { searchFiles, search_files_definition } from "./search_files.js";
import { web, web_definition } from "./web.js";
import { analyzeMedia, analyze_media_definition } from "./analyze_media.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

// ── Tool Definitions (sent to the model) ──────────────────────────────────────

export const toolDefinitions: ChatCompletionTool[] = [
  read_file_definition,
  write_file_definition,
  bash_definition,
  list_files_definition,
  search_files_definition,
  web_definition,
  analyze_media_definition,
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  switch (name) {
    case "read_file":    return readFile(args);
    case "write_file":   return writeFile(args);
    case "bash":         return bash(args);
    case "list_files":   return listFiles(args);
    case "search_files": return searchFiles(args);
    case "web":          return await web(args);
    case "analyze_media": return await analyzeMedia(args);
    default:             return `Unknown tool: ${name}`;
  }
}
