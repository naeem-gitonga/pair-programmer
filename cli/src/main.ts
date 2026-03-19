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
      console.log(`  ${chalk.cyan("/help")}   show this help`);
      console.log(`  ${chalk.cyan("/model")}  switch between models defined in models.json`);
      console.log();
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

      // Engagement spinner — visible immediately while the request is being sent
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frameIdx = 0;
      const engageSpinner = setInterval(() => {
        process.stdout.write(`\r${chalk.hex("#FFA500")(frames[frameIdx++ % frames.length])} Sending to model...  `);
      }, 80);

      await runAgent(client, userMessage, history, currentModelId, () => {
        clearInterval(engageSpinner);
        process.stdout.write("\r\x1b[K");
      });
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  };

  await input.start(processMessage);
}

main();
