import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni, fromEnv } from "@aws-sdk/credential-providers";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.js";

export interface BedrockConfig {
  region: string;
  modelId: string;
}

export interface BedrockStreamChunk {
  type: "text";
  text: string;
}

export interface BedrockToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface BedrockResult {
  content: string;
  toolCalls: BedrockToolCall[];
  stopReason: string;
}

// ── Client factory ─────────────────────────────────────────────────────────────

export function createBedrockClient(config: BedrockConfig): BedrockRuntimeClient {
  const profile = process.env.AWS_PROFILE;
  const credentials = profile
    ? fromIni({ profile })
    : process.env.AWS_ACCESS_KEY_ID
      ? fromEnv()
      : undefined;

  return new BedrockRuntimeClient({ region: config.region, credentials });
}

// ── URL helpers ────────────────────────────────────────────────────────────────

export function isBedrockUrl(url: string): boolean {
  return url.includes("bedrock-runtime.") && url.includes("amazonaws.com");
}

export function bedrockConfigFromUrl(url: string, modelId: string): BedrockConfig {
  // url format: https://bedrock-runtime.<region>.amazonaws.com
  const match = url.match(/bedrock-runtime\.([^.]+)\.amazonaws\.com/);
  const region = match?.[1] ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  return { region, modelId };
}

// ── Message conversion ─────────────────────────────────────────────────────────

function convertHistory(messages: ChatCompletionMessageParam[]) {
  const result: any[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Skip system messages — passed via the system field
    if (msg.role === "system") { i++; continue; }

    // Merge consecutive tool results into one user message
    if (msg.role === "tool") {
      const toolResults: any[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i] as any;
        toolResults.push({
          toolResult: {
            toolUseId: t.tool_call_id,
            content: [{ text: t.content ?? "" }],
          },
        });
        i++;
      }
      result.push({ role: "user", content: toolResults });
      continue;
    }

    // Assistant with tool calls
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      result.push({
        role: "assistant",
        content: [
          ...(msg.content ? [{ text: msg.content }] : []),
          ...msg.tool_calls.filter((tc) => tc.type === "function").map((tc) => ({
            toolUse: {
              toolUseId: tc.id,
              name: (tc as { type: "function"; function: { name: string; arguments: string } }).function.name,
              input: JSON.parse((tc as { type: "function"; function: { name: string; arguments: string } }).function.arguments),
            },
          })),
        ],
      });
      i++;
      continue;
    }

    // Regular user or assistant message
    result.push({
      role: msg.role,
      content: [{ text: (msg.content as string) ?? "" }],
    });
    i++;
  }

  return result;
}

function convertTools(tools: ChatCompletionTool[]): any[] {
  return tools.filter((t) => t.type === "function").map((t) => {
    const fn = (t as { type: "function"; function: { name: string; description?: string; parameters?: object } }).function;
    return {
      toolSpec: {
        name: fn.name,
        description: fn.description,
        inputSchema: { json: fn.parameters ?? {} },
      },
    };
  });
}

// ── Streaming ──────────────────────────────────────────────────────────────────

export async function streamBedrock(
  client: BedrockRuntimeClient,
  config: BedrockConfig,
  systemPrompt: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
): Promise<BedrockResult> {
  const command = new ConverseStreamCommand({
    modelId: config.modelId,
    system: [{ text: systemPrompt }],
    messages: convertHistory(messages),
    toolConfig: { tools: convertTools(tools) },
  });

  const response = await client.send(command);
  if (!response.stream) throw new Error("No stream in Bedrock response");

  let content = "";
  const toolCalls: BedrockToolCall[] = [];
  let stopReason = "end_turn";

  // Track tool call being built by content block index
  const pendingToolCalls: Record<number, { id: string; name: string; input: string }> = {};
  let currentBlockIdx = -1;

  for await (const event of response.stream) {
    if (event.contentBlockStart) {
      currentBlockIdx = event.contentBlockStart.contentBlockIndex ?? -1;
      const toolUse = event.contentBlockStart.start?.toolUse;
      if (toolUse) {
        pendingToolCalls[currentBlockIdx] = {
          id: toolUse.toolUseId ?? "",
          name: toolUse.name ?? "",
          input: "",
        };
      }
    }

    if (event.contentBlockDelta) {
      const delta = event.contentBlockDelta.delta;
      if (delta?.text) {
        content += delta.text;
      }
      if (delta?.toolUse?.input && currentBlockIdx >= 0) {
        pendingToolCalls[currentBlockIdx].input += delta.toolUse.input;
      }
    }

    if (event.messageStop) {
      stopReason = event.messageStop.stopReason ?? "end_turn";
    }
  }

  // Finalise tool calls
  for (const tc of Object.values(pendingToolCalls)) {
    toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.input });
  }

  return { content, toolCalls, stopReason };
}
