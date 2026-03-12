#!/usr/bin/env tsx
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
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { status: string; model: string; model_loaded: boolean };
    if (!data.model_loaded) {
      console.log(chalk.yellow(`⏳ Model loading... (status: ${data.status})`));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Connected to ${SERVER_URL} — model: ${data.model}`));
  } catch (err) {
    console.error(chalk.red(`✗ Cannot reach server at ${SERVER_URL}`));
    console.error(chalk.gray(`  Start your LLM server first, then run this again.`));
    process.exit(1);
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
