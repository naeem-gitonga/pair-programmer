import { readFileSync, } from "fs";

export const read_file_definition = {
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
} as const;

export function readFile({ path }: ToolArgs): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
