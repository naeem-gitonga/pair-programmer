import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { toolDefinitions, executeTool } from "./tools.js";
import { MODEL_NAME, MAX_TOKENS, TEMPERATURE } from "./config.js";

const SYSTEM_PROMPT = `You are a coding assistant running locally. You help users write, read, debug, and refactor code.

You have access to tools that let you interact with the filesystem and run shell commands. Use them freely to understand the codebase and make changes.

Guidelines:
- Always read a file before editing it
- Run tests after making changes when possible
- Be concise in your responses — show code, not lengthy explanations
- When writing files, write complete file contents, not partial diffs`;

export async function runAgent(
  client: OpenAI,
  userMessage: string,
  history: ChatCompletionMessageParam[],
): Promise<void> {
  // Add user message to history
  history.push({ role: "user", content: userMessage });

  // Agentic loop — continues until model stops calling tools
  while (true) {
    const stream = await client.chat.completions.create({
      model: MODEL_NAME,
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

    process.stdout.write(chalk.cyan("\nAssistant: "));

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

      if (delta?.content) {
        process.stdout.write(delta.content);
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

    process.stdout.write("\n");

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

        process.stdout.write(chalk.yellow(`\n[tool] ${tc.name}(${JSON.stringify(args)})\n`));

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
