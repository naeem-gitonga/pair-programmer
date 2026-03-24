import { execSync } from "child_process";

export const bash_definition = {
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
} as const;

export function bash({ command }: ToolArgs): string {
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
