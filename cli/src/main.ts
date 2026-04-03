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
import { log } from "./logger.js";
import { readAppConfig, writeAppConfig } from "./persist.js";
import { FullScreenInput } from "./input.js";
import { showModelPicker, loadModels } from "./model-picker.js";
import { showSettingsPicker, promptText } from "./settings-picker.js";

/** Normalize \r\n and bare \r to \n so terminal output doesn't clobber lines. */
function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

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
  log.info(`Starting Pair Programmer (server: ${SERVER_URL})`);
  console.log(chalk.bold("\nPair Programmer"));
  console.log(chalk.gray(`Log's dir: ${log.dir}`));
  console.log(chalk.gray(`Log file: ${log.file}`));
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

  let savedConfig = readAppConfig();

  // First-run prompts — only ask if value hasn't been saved yet
  if (savedConfig.smolvlmServerUrl === undefined) {
    const url = await promptText("SmolVLM Server URL (vision/video model)", "http://localhost:8005");
    savedConfig.smolvlmServerUrl = url;
    writeAppConfig({ smolvlmServerUrl: url });
  }
  if (savedConfig.awsProfile === undefined) {

    const profile = await promptText("\n\n\nAWS Profile  (leave blank to use default)", "");
    savedConfig.awsProfile = profile || undefined;
    writeAppConfig({ awsProfile: profile || undefined });
  }
  if (savedConfig.awsProfile) {
    process.env.AWS_PROFILE = savedConfig.awsProfile;
    log.info(`Using AWS profile: ${savedConfig.awsProfile}`);
  }

  let currentUrl = savedConfig.localServerUrl ?? SERVER_URL;
  let currentModelId = MODEL_NAME;
  let client = makeClient(currentUrl);

  if (!isBedrockUrl(currentUrl)) {
    while (true) {
      const connected = await checkServer(currentUrl, 1);
      if (connected) break;

      console.log(chalk.red(`✗ Server at ${currentUrl} is unavailable.`));

      // Derive the purpose of the failing model so the picker opens on the right category.
      // Default to "text" so the picker skips the purpose selection step on startup.
      const failingPurpose = loadModels().find(m => m.url === currentUrl)?.purpose ?? "text";

      const picked = await showModelPicker(currentModelId, currentUrl, failingPurpose);
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
        const indented = normalizeNewlines(userMessage).split("\n").map(l => "  " + l).join("\n");
        console.log(chalk.white(indented) + "\n");
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

      // Stop the spinner and erase it BEFORE the agent prints any output.
      // The spinner uses \x1b[s/\x1b[u (save/restore cursor) which is safe while
      // nothing is scrolling — but once runAgent starts writing and the terminal
      // scrolls, the saved cursor position drifts off-screen. Clearing first
      // ensures the response always appears at the correct scroll position.
      if (engageSpinner) clearInterval(engageSpinner);
      if (process.stdout.isTTY) {
        process.stdout.write(`\x1b[${spinnerRow};1H\x1b[K`); // erase spinner line
      }

      if (isBedrockUrl(currentUrl)) {
        await runBedrockAgent(bedrockConfigFromUrl(currentUrl, currentModelId), messageWithContext, history);
      } else {
        await runAgent(client, messageWithContext, history, currentModelId);
      }

      // Print elapsed time inline — no cursor gymnastics needed since the
      // terminal has already scrolled to its natural position after the response.
      if (process.stdout.isTTY) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(chalk.hex("#FFA500")(`⏱ ${elapsed}s\n`));
      }
    } catch (err) {
      log.error("Agent error", err);
      console.error(chalk.red(`\nError: ${(err as Error).message}`));
    }
  };

  await input.start(processMessage);
}

main();
