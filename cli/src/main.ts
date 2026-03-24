#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
config({ path: resolve(fileURLToPath(import.meta.url), "../../../.env"), quiet: true });
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { runAgent, runBedrockAgent, setApprovalCallbacks } from "./agent.js";
import { isBedrockUrl, bedrockConfigFromUrl } from "./bedrock-client.js";
import { SERVER_URL, MODEL_NAME } from "./config.js";
import { readAppConfig } from "./persist.js";
import { FullScreenInput } from "./input.js";
import { showModelPicker } from "./model-picker.js";
import { showSettingsPicker } from "./settings-picker.js";

function readIdeContext(): string | null {
  const contextFile = join(homedir(), ".pair-programmer", "context.json");
  if (!existsSync(contextFile)) return null;
  try {
    const ctx = JSON.parse(readFileSync(contextFile, "utf-8"));
    let msg = `[IDE context: file="${ctx.file}", language=${ctx.language}, line=${ctx.line}`;
    if (ctx.selection) msg += `, selected text:\n${ctx.selection}`;
    msg += "]";
    return msg;
  } catch {
    return null;
  }
}

function makeClient(url: string): OpenAI {
  return new OpenAI({ baseURL: `${url}/v1`, apiKey: "local" });
}

async function checkServer(url: string, maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        process.stdout.write("\n");
        console.log(chalk.green(`✓ Connected to ${url}`));
        return true;
      }
      process.stdout.write(chalk.yellow(`\r⏳ Model loading...        `));
    } catch {
      process.stdout.write(chalk.yellow(`\r⏳ Waiting for server at ${url}...        `));
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.stdout.write("\n");
  return false;
}

async function main(): Promise<void> {
  console.log(chalk.bold("\nPair Programmer"));
  console.log(chalk.gray(`Server: ${SERVER_URL}`));
  console.log(chalk.hex("#FFA500")("Type /help for available commands"));
  console.log(chalk.gray("Initializing...\n"));

  // Log the largest French-speaking city info
  console.log(chalk.bold.blue("Did you know?"));
  console.log(chalk.white("  The largest French-speaking city in the world is"));
  console.log(chalk.cyan("  Kinshasa, Democratic Republic of the Congo"));
  console.log(chalk.white("  Population: ~12.7 million"));
  console.log();

  const history: ChatCompletionMessageParam[] = [];
  const input = new FullScreenInput();

  const savedConfig = readAppConfig();
  let currentUrl = savedConfig.localServerUrl ?? SERVER_URL;
  let currentModelId = MODEL_NAME;
  let client = makeClient(currentUrl);

  if (!isBedrockUrl(currentUrl)) {
    while (true) {
      const connected = await checkServer(currentUrl, 1);
      if (connected) break;

      console.log(chalk.red(`✗ Server at ${currentUrl} is unavailable.`));
      const picked = await showModelPicker(currentModelId, currentUrl);
      if (!picked) {
        console.log(chalk.gray("No model selected. Exiting."));
        process.exit(1);
      }
      currentModelId = picked.modelId;
      currentUrl = picked.url;
      client = makeClient(currentUrl);
      if (isBedrockUrl(currentUrl)) break; // Bedrock needs no health check
    }
  }

  const processMessage = async (userMessage: string) => {
    const trimmed = userMessage.trim();
    
    if (trimmed === "/help") {
      console.log(chalk.bold("\nAvailable commands:"));
      console.log(`  ${chalk.cyan("/help")}         show this help`);
      console.log(`  ${chalk.cyan("/model")}        switch between models defined in models.json`);
      console.log(`  ${chalk.cyan("/model text")}   switch to text models only`);
      console.log(`  ${chalk.cyan("/model image")}  switch to image/video models only`);
      console.log(`  ${chalk.cyan("/settings")}   cycle tool output verbosity: limited (2 lines) → some (10 lines) → all`);
      console.log();
      return;
    }

    if (trimmed === "/settings") {
      const changes = await showSettingsPicker();
      if (changes.localServerUrl && changes.localServerUrl !== currentUrl) {
        currentUrl = changes.localServerUrl;
        client = makeClient(currentUrl);
        console.log(chalk.green(`\nLocal server URL updated to: ${currentUrl}\n`));
      }
      return;
    }

    // Handle /model with optional purpose filter
    if (trimmed.startsWith("/model")) {
      const purpose = trimmed.split(" ")[1]?.trim();
      const picked = await showModelPicker(currentModelId, currentUrl, purpose);
      if (picked) {
        const switched = picked.modelId !== currentModelId || picked.url !== currentUrl;
        currentModelId = picked.modelId;
        currentUrl = picked.url;
        client = makeClient(currentUrl);
        if (switched) {
          console.log(chalk.green(`\nSwitched to: ${picked.name} @ ${picked.url}\n`));
        }
      }
      return;
    }

    try {
      if (process.stdout.isTTY) {
        const cols = process.stdout.columns;
        console.log(chalk.cyan("═".repeat(cols)));
        console.log(chalk.bold("\n  YOU:"));
        console.log(chalk.white(`  ${userMessage}\n`));
        console.log(chalk.cyan("═".repeat(cols)));
        console.log();
      }

      // Animated spinner — only in TTY mode
      const spinFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      const catchPhrases = [
        "I'm trying, I'm trying...",
        "Let me think...",
        "Working on it...",
        "Just a moment...",
        "Processing...",
        "One sec...",
        "Almost there...",
      ];
      let spinIdx = 0;
      let phraseIdx = 0;
      const spinnerRow = process.stdout.rows || 24;
      let startTime = Date.now();
      const startSpinner = (): NodeJS.Timeout | null => {
        if (!process.stdout.isTTY) return null;
        return setInterval(() => {
          if (spinIdx % Math.round(5000 / 80) === 0 && spinIdx > 0) phraseIdx++;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const frame = chalk.cyan(spinFrames[spinIdx++ % spinFrames.length]);
          const text = chalk.hex("#FFA500")(catchPhrases[phraseIdx % catchPhrases.length]);
          const time = chalk.hex("#FFA500")(`${elapsed}s`);
          process.stdout.write(`\x1b[s\x1b[${spinnerRow};1H\x1b[K${frame} ${text} ${time}\x1b[u`);
        }, 80);
      };
      let engageSpinner = startSpinner();

      let pauseStart = 0;
      setApprovalCallbacks(
        () => { if (engageSpinner) clearInterval(engageSpinner); pauseStart = Date.now(); input.pause(); },
        () => { startTime += Date.now() - pauseStart; engageSpinner = startSpinner(); input.resume(); },
      );

      const ideContext = readIdeContext();
      const messageWithContext = ideContext ? `${ideContext}\n\n${userMessage}` : userMessage;

      if (isBedrockUrl(currentUrl)) {
        await runBedrockAgent(bedrockConfigFromUrl(currentUrl, currentModelId), messageWithContext, history);
      } else {
        await runAgent(client, messageWithContext, history, currentModelId);
      }

      if (engageSpinner) clearInterval(engageSpinner);
      if (process.stdout.isTTY) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const elapsedText = chalk.hex("#FFA500")(`⏱ ${elapsed}s`);
        const elapsedPlain = `⏱ ${elapsed}s`;
        const col = Math.max(1, (process.stdout.columns || 80) - elapsedPlain.length);
        process.stdout.write(`\x1b[s\x1b[${spinnerRow};1H\x1b[K\x1b[${spinnerRow};${col}H${elapsedText}\x1b[u`);
      }
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  };

  await input.start(processMessage);
}

main();
