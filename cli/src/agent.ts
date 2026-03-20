import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { execSync } from "child_process";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { toolDefinitions, executeTool } from "./tools.js";
import { MODEL_NAME, TEMPERATURE } from "./config.js";
import { createBedrockClient, streamBedrock, type BedrockConfig } from "./bedrock-client.js";

type ToolOutputMode = "limited" | "some" | "all";
let toolOutputMode: ToolOutputMode = "limited";
export function setToolOutputMode(mode: ToolOutputMode) { toolOutputMode = mode; }
export function getToolOutputMode(): ToolOutputMode { return toolOutputMode; }

let _onApprovalPause: (() => void) | undefined;
let _onApprovalResume: (() => void) | undefined;
export function setApprovalCallbacks(onPause: () => void, onResume: () => void) {
  _onApprovalPause = onPause;
  _onApprovalResume = onResume;
}

function truncateToolOutput(output: string): string {
  const lines = output.split("\n");
  if (toolOutputMode === "all") return output;
  const limit = toolOutputMode === "limited" ? 2 : 10;
  if (lines.length <= limit) return output;
  return lines.slice(0, limit).join("\n") + chalk.gray(`\n… (${lines.length - limit} more lines — use /settings to show more)`);
}
import { renderMarkdown } from "./markdown.js";

function readKey(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const onData = (data: Buffer) => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      const key = data.toString().toLowerCase().trim();
      process.stdout.write("\n");
      resolve(key);
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

function showDiff(filePath: string, oldContent: string, newContent: string): void {
  const tmpOld = join(tmpdir(), `pair-prog-old-${basename(filePath)}`);
  const tmpNew = join(tmpdir(), `pair-prog-new-${basename(filePath)}`);
  writeFileSync(tmpOld, oldContent);
  writeFileSync(tmpNew, newContent);

  process.stdout.write(chalk.bold(`\n─── ${filePath} ───\n`));

  try {
    execSync(`diff -u "${tmpOld}" "${tmpNew}"`, { encoding: "utf-8" });
    process.stdout.write(chalk.gray("(no changes)\n"));
  } catch (e: any) {
    const lines: string[] = (e.stdout as string).split("\n");
    for (const line of lines.slice(2)) { // skip --- and +++ header lines
      if (line.startsWith("@@"))       process.stdout.write(chalk.cyan(line) + "\n");
      else if (line.startsWith("+"))   process.stdout.write(chalk.green(line) + "\n");
      else if (line.startsWith("-"))   process.stdout.write(chalk.red(line) + "\n");
      else                             process.stdout.write(chalk.gray(line) + "\n");
    }
  }
}

async function approveWriteFile(filePath: string, newContent: string): Promise<boolean> {
  const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  showDiff(filePath, oldContent, newContent);
  _onApprovalPause?.();
  const key = await readKey(chalk.bold("\nApply changes? [y/N] "));
  _onApprovalResume?.();
  return key === "y";
}

export const SYSTEM_PROMPT = `You are a coding assistant running locally. You help users write, read, debug, and refactor code.

You are working inside the project at: ${process.cwd()}
The project root (parent directory) is: ${new URL('../..', import.meta.url).pathname}
Key config files like models.json live in the project root, not in the cli/ subdirectory.

You have access to tools that let you interact with the filesystem and run shell commands. Use them freely to understand the codebase and make changes.

HARD CONSTRAINTS — these override everything else:
1. The bash tool has NO TTY. stdin is not a terminal. Calling setRawMode(), isatty(), or any interactive input will immediately fail with an error. Do not try. Do not retry. If a program needs keyboard input, you cannot run it — period.
2. For keyboard shortcuts and terminal escape codes: you must ask the user to run the capture script themselves and paste the hex output. Do not guess sequences. Do not implement without the actual output. Stop and wait.

Guidelines:

PLANNING (required before any code is written):
- For any task that touches more than one file, you MUST first read ALL files that will be affected — including files that call or import the ones you plan to change. Do not skip this even if you think you understand the structure.
- After reading, explicitly list: (1) every file you will change, (2) what integration points connect them, (3) any data format conversions required. Present this plan to the user and wait for explicit approval before writing a single line of code.
- For complex multi-file changes this check-in is NOT optional — the user must confirm the plan even if they already described what they want. Missing an integration point wastes both your time and theirs.

IMPLEMENTATION:
- Before implementing any feature, search the codebase to check if it already exists or is partially implemented — never duplicate existing work
- When adding something similar to an existing implementation (e.g. a new keyboard shortcut), always read the existing handler first and follow the same pattern
- When a user mentions a file by name without a path, ALWAYS use list_files or search_files to locate it first before attempting to read it — never assume the path
- Always read a file before editing it
- Run tests after making changes when possible
- Be concise in your responses — show code, not lengthy explanations
- When writing files, write complete file contents, not partial diffs
- NEVER read from, search in, or include node_modules/ in any tool call — always exclude it explicitly (e.g. add -not -path '*/node_modules/*' to find commands, --ignore node_modules to ripgrep, etc.)`;

export async function runAgent(
  client: OpenAI,
  userMessage: string,
  history: ChatCompletionMessageParam[],
  modelName: string = MODEL_NAME,
): Promise<void> {
  history.push({ role: "user", content: userMessage });

  // Agentic loop — continues until model stops calling tools
  while (true) {
    const stream = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      tools: toolDefinitions,
      tool_choice: "auto",
      temperature: TEMPERATURE,
      stream: true,
    });

    // Accumulate streamed response
    let content = "";
    const toolCallAccumulator: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

      if (delta?.content) {
        content += delta.content;
      }

      // Accumulate tool call deltas
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulator[idx]) {
            toolCallAccumulator[idx] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          if (tc.id) toolCallAccumulator[idx].id = tc.id;
          if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
        }
      }
    }

    if (content) {
      process.stdout.write(chalk.cyan("\nAssistant:\n"));
      process.stdout.write(renderMarkdown(content));
      process.stdout.write("\n");
    }

    const toolCalls = Object.values(toolCallAccumulator);

    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      // Add assistant message with tool calls to history
      history.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool and append results
      for (const tc of toolCalls) {
        let args: Record<string, string>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }

        // For write_file, only show path — content is shown in the diff below
        const displayArgs = tc.name === "write_file"
          ? { path: args.path, bytes: args.content?.length ?? 0 }
          : args;
        process.stdout.write(chalk.yellow(`\n[tool] ${tc.name}(${JSON.stringify(displayArgs)})\n`));

        if (tc.name === "write_file") {
          const allowed = await approveWriteFile(args.path, args.content ?? "");
          if (!allowed) {
            // Keep history intact so the model retains context — just record the decline
            history.push({ role: "tool", tool_call_id: tc.id, content: "User declined this file change." });
            history.push({ role: "assistant", content: "The file change was declined. I'll wait for further instructions." });
            process.stdout.write(chalk.red("\n  Change declined. Waiting for your next instruction.\n"));
            return;
          }
        }

        const result = await executeTool(tc.name, args);

        process.stdout.write(chalk.gray(truncateToolOutput(result) + "\n"));

        history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Continue the loop — send tool results back to model
      continue;
    }

    // Model finished with a regular response — add to history and exit loop
    history.push({ role: "assistant", content });
    break;
  }
}

// ── Bedrock agent loop ─────────────────────────────────────────────────────────

export async function runBedrockAgent(
  bedrockConfig: BedrockConfig,
  userMessage: string,
  history: ChatCompletionMessageParam[],
): Promise<void> {
  history.push({ role: "user", content: userMessage });
  const client = createBedrockClient(bedrockConfig);

  while (true) {
    const result = await streamBedrock(client, bedrockConfig, SYSTEM_PROMPT, history, toolDefinitions);

    if (result.content) {
      process.stdout.write(chalk.cyan("\nAssistant:\n"));
      process.stdout.write(renderMarkdown(result.content));
      process.stdout.write("\n");
    }

    if (result.stopReason === "tool_use" && result.toolCalls.length > 0) {
      history.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of result.toolCalls) {
        let args: Record<string, string>;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }

        const displayArgs = tc.name === "write_file"
          ? { path: args.path, bytes: args.content?.length ?? 0 }
          : args;
        process.stdout.write(chalk.yellow(`\n[tool] ${tc.name}(${JSON.stringify(displayArgs)})\n`));

        if (tc.name === "write_file") {
          const allowed = await approveWriteFile(args.path, args.content ?? "");
          if (!allowed) {
            history.push({ role: "tool", tool_call_id: tc.id, content: "User declined this file change." });
            history.push({ role: "assistant", content: "The file change was declined. I'll wait for further instructions." });
            process.stdout.write(chalk.red("\n  Change declined. Waiting for your next instruction.\n"));
            return;
          }
        }

        const toolResult = await executeTool(tc.name, args);
        process.stdout.write(chalk.gray(truncateToolOutput(toolResult) + "\n"));
        history.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      }

      continue;
    }

    history.push({ role: "assistant", content: result.content });
    break;
  }
}
