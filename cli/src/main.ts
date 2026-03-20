#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(fileURLToPath(import.meta.url), "../../../.env"), quiet: true });
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { runAgent } from "./agent.js";
import { SERVER_URL, MODEL_NAME } from "./config.js";
import { FullScreenInput } from "./input.js";
import { showModelPicker } from "./model-picker.js";
import { showSettingsPicker } from "./settings-picker.js";

function makeClient(url: string): OpenAI {
  return new OpenAI({ baseURL: `${url}/v1`, apiKey: "local" });
}

async function checkServer(url: string): Promise<void> {
  while (true) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        process.stdout.write("\n");
        console.log(chalk.green(`✓ Connected to ${url}`));
        return;
      }
      process.stdout.write(chalk.yellow(`\r⏳ Model loading...        `));
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      process.stdout.write(chalk.yellow(`\r⏳ Waiting for server at ${url}...        `));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold("\nPair Programmer"));
  console.log(chalk.gray(`Server: ${SERVER_URL}`));
  console.log(chalk.hex("#FFA500")("Type /help for available commands"));
  console.log(chalk.gray("Initializing...\n"));

  await checkServer(SERVER_URL);

  const history: ChatCompletionMessageParam[] = [];
  const input = new FullScreenInput();

  let currentUrl = SERVER_URL;
  let currentModelId = MODEL_NAME;
  let client = makeClient(currentUrl);

  const processMessage = async (userMessage: string) => {
    if (userMessage.trim() === "/help") {
      console.log(chalk.bold("\nAvailable commands:"));
      console.log(`  ${chalk.cyan("/help")}         show this help`);
      console.log(`  ${chalk.cyan("/model")}        switch between models defined in models.json`);
      console.log(`  ${chalk.cyan("/settings")}  cycle tool output verbosity: limited (2 lines) → some (10 lines) → all`);
      console.log();
      return;
    }

    if (userMessage.trim() === "/settings") {
      await showSettingsPicker();
      return;
    }

    if (userMessage.trim() === "/model") {
      const picked = await showModelPicker(currentModelId, currentUrl);
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
      const cols = process.stdout.columns;
      console.log(chalk.cyan("═".repeat(cols)));
      console.log(chalk.bold("\n  YOU:"));
      console.log(chalk.white(`  ${userMessage}\n`));
      console.log(chalk.cyan("═".repeat(cols)));
      console.log();

      // Animated spinner pinned to bottom-left — frame animates at 80ms, phrase changes every 5s, elapsed time shown
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
      const startTime = Date.now();
      const engageSpinner = setInterval(() => {
        if (spinIdx % Math.round(5000 / 80) === 0 && spinIdx > 0) phraseIdx++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const frame = chalk.cyan(spinFrames[spinIdx++ % spinFrames.length]);
        const text = chalk.hex("#FFA500")(catchPhrases[phraseIdx % catchPhrases.length]);
        const time = chalk.hex("#FFA500")(`${elapsed}s`);
        process.stdout.write(`\x1b[s\x1b[${spinnerRow};1H\x1b[K${frame} ${text} ${time}\x1b[u`);
      }, 80);

      await runAgent(client, userMessage, history, currentModelId);

      clearInterval(engageSpinner);
      process.stdout.write(`\x1b[s\x1b[${spinnerRow};1H\x1b[K\x1b[u`); // clear spinner
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  };

  await input.start(processMessage);
}

main();
