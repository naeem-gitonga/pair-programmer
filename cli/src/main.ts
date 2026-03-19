#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(fileURLToPath(import.meta.url), "../../../.env") });
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { runAgent } from "./agent.js";
import { SERVER_URL, MODEL_NAME } from "./config.js";
import { FullScreenInput } from "./input.js";
import { showModelPicker } from "./model-picker.js";

const client = new OpenAI({
  baseURL: `${SERVER_URL}/v1`,
  apiKey: "local",  // required by SDK but unused by local server
});

async function checkServer(): Promise<void> {
  while (true) {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok) {
        process.stdout.write("\n");
        console.log(chalk.green(`✓ Connected to ${SERVER_URL}`));
        return;
      }
      process.stdout.write(chalk.yellow(`\r⏳ Model loading...        `));
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      process.stdout.write(chalk.yellow(`\r⏳ Waiting for server at ${SERVER_URL}...        `));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold("\nPair Programmer"));
  console.log(chalk.gray(`Server: ${SERVER_URL}  · type /model to switch models`));
  console.log(chalk.gray("Initializing full-screen input mode...\n"));

  await checkServer();

  const history: ChatCompletionMessageParam[] = [];
  const input = new FullScreenInput();
  let currentModel = MODEL_NAME;

  const processMessage = async (userMessage: string) => {
    // Handle slash commands
    if (userMessage.trim() === "/model") {
      const picked = await showModelPicker(SERVER_URL, currentModel);
      if (picked && picked !== currentModel) {
        currentModel = picked;
        console.log(chalk.green(`\nSwitched to model: ${currentModel}\n`));
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

      await runAgent(client, userMessage, history, currentModel);
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  };

  await input.start(processMessage);
}

main();
