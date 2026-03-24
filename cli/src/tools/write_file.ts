import { writeFileSync } from "fs";

export const write_file_definition = {
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
} as const;

export function writeFile({ path, content }: ToolArgs): string {
  try {
    writeFileSync(path, content, "utf-8");
    return `Written ${content.length} bytes to ${path}`;
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
