import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

export interface ModelConfig {
  name: string;
  url: string;
  modelId: string;
}

function loadModels(): ModelConfig[] {
  const configPath = resolve(fileURLToPath(import.meta.url), "../../../models.json");
  if (!existsSync(configPath)) return [];
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ModelConfig[];
  } catch {
    return [];
  }
}

export async function showModelPicker(
  currentModelId: string,
  currentUrl: string,
): Promise<ModelConfig | null> {
  const models = loadModels();

  if (models.length === 0) {
    process.stdout.write(chalk.red("\nNo models found. Add entries to models.json at the project root.\n"));
    return null;
  }

  let selected = Math.max(
    0,
    models.findIndex((m) => m.modelId === currentModelId && m.url === currentUrl),
  );

  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(chalk.bold("  Select Model\n"));
    process.stdout.write(chalk.gray("  ↑↓ navigate · Enter select · Esc cancel\n\n"));

    for (let i = 0; i < models.length; i++) {
      const isActive = models[i].modelId === currentModelId && models[i].url === currentUrl;
      const isCursor = i === selected;
      const label = `${models[i].name}  ${chalk.gray(models[i].url)}`;

      if (isCursor) {
        process.stdout.write(chalk.cyan(`  ▶ ${label}${isActive ? chalk.gray("  (active)") : ""}\n`));
      } else {
        process.stdout.write(`    ${label}${isActive ? chalk.gray("  (active)") : ""}\n`);
      }
    }

    process.stdout.write(chalk.gray("\n  Edit models.json to add or remove models.\n"));
  };

  return new Promise((resolve) => {
    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (data: Buffer) => {
      const seq = data.toString();

      if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); render(); return; }
      if (seq === "\x1b[B") { selected = Math.min(models.length - 1, selected + 1); render(); return; }

      if (seq === "\r" || seq === "\n") { cleanup(); resolve(models[selected]); return; }
      if (seq === "\x1b" || seq === "\x03") { cleanup(); resolve(null); return; }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdout.write("\x1b[2J\x1b[H");
    };

    process.stdin.on("data", onData);
  });
}
