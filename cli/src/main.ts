#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(fileURLToPath(import.meta.url), "../../../.env") });
import readline from "readline";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import chalk from "chalk";
import { runAgent } from "./agent.js";
import { SERVER_URL, MODEL_NAME } from "./config.js";

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
  console.log(chalk.gray(`Model: ${MODEL_NAME} @ ${SERVER_URL}`));
  console.log(chalk.gray("Type your message, or 'exit' to quit.\n"));

  await checkServer();

  const history: ChatCompletionMessageParam[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = (): Promise<string> =>
    new Promise((resolve) => rl.question(chalk.bold("\nYou: "), resolve));

  while (true) {
    const input = (await prompt()).trim();

    if (!input) continue;
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      console.log(chalk.gray("\nBye."));
      rl.close();
      break;
    }

    try {
      await runAgent(client, input, history);
    } catch (err) {
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  }
}

main();
