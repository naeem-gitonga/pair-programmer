import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { execSync } from "child_process";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { toolDefinitions, executeTool } from "./tools.js";
import { MODEL_NAME, MAX_TOKENS, TEMPERATURE } from "./config.js";
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
  const key = await readKey(chalk.bold("\nApply changes? [y/N] "));
  return key === "y";
}

const SYSTEM_PROMPT = `You are a coding assistant running locally. You help users write, read, debug, and refactor code.

You are working inside the project at: ${process.cwd()}

You have access to tools that let you interact with the filesystem and run shell commands. Use them freely to understand the codebase and make changes.

Guidelines:
- When a user asks you to implement something, implement it directly in the codebase — do not explain how to do it, just do it
- Before implementing any feature, search the codebase to check if it already exists or is partially implemented — never duplicate existing work
- When a user mentions a file by name without a path, ALWAYS use list_files or search_files to locate it first before attempting to read it — never assume the path
- Always read a file before editing it — understand the existing code and fit your changes into it
- Run tests after making changes when possible
- Be concise in your responses — show code, not lengthy explanations
- When writing files, write complete file contents, not partial diffs
- NEVER read from, search in, or include node_modules/ in any tool call — always exclude it explicitly (e.g. add -not -path '*/node_modules/*' to find commands, --ignore node_modules to ripgrep, etc.)`;

export async function runAgent(
  client: OpenAI,
  userMessage: string,
  history: ChatCompletionMessageParam[],
  modelName: string = MODEL_NAME,
  onFirstToken?: () => void,
): Promise<void> {
  // Track where history was before this call so we can roll back on decline
  const historyLengthBefore = history.length;
  history.push({ role: "user", content: userMessage });

  // Agentic loop — continues until model stops calling tools
  while (true) {
    const stream = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      tools: toolDefinitions,
      tool_choice: "auto",
      max_tokens: MAX_TOKENS,
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
    let firstToken = true;

    // Spinner while waiting for first token
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frameIdx = 0;
    const spinner = setInterval(() => {
      process.stdout.write(`\r${chalk.cyan(frames[frameIdx++ % frames.length])} Thinking...  `);
    }, 80);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

      if (firstToken && (delta?.content || delta?.tool_calls)) {
        firstToken = false;
        clearInterval(spinner);
        onFirstToken?.();
        process.stdout.write(`\r\x1b[K`); // clear spinner line
      }

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

    clearInterval(spinner);
    if (firstToken) {
      onFirstToken?.();
      process.stdout.write(`\r\x1b[K`);
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
            // Roll back history to before this task so the next message starts clean
            history.splice(historyLengthBefore);
            process.stdout.write(chalk.red("\n  Change declined. Waiting for your next instruction.\n"));
            return;
          }
        }

        const result = await executeTool(tc.name, args);

        process.stdout.write(chalk.gray(`${result.slice(0, 500)}${result.length > 500 ? "…" : ""}\n`));

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
