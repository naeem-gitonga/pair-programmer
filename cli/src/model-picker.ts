import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

export interface ModelConfig {
  name: string;
  url: string;
  modelId: string;
  purpose?: string;
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

function groupModelsByPurpose(models: ModelConfig[]): Record<string, ModelConfig[]> {
  const groups: Record<string, ModelConfig[]> = {};
  for (const model of models) {
    const purpose = model.purpose || "uncategorized";
    if (!groups[purpose]) {
      groups[purpose] = [];
    }
    groups[purpose].push(model);
  }
  return groups;
}

async function pickPurpose(currentPurpose: string | undefined): Promise<string | null> {
  const models = loadModels();
  const groups = groupModelsByPurpose(models);
  const purposes = Object.keys(groups).sort();
  
  if (purposes.length === 0) {
    process.stdout.write(chalk.red(`\nNo models found in models.json.\n`));
    return null;
  }

  let selected = purposes.indexOf(currentPurpose || purposes[0]);
  if (selected < 0) selected = 0;

  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(chalk.bold("  Select Model Purpose"));
    process.stdout.write("\n");
    process.stdout.write(chalk.gray("  ↑↓ navigate · Enter select · Esc cancel\n\n"));

    for (let i = 0; i < purposes.length; i++) {
      const purpose = purposes[i];
      const isActive = purpose === currentPurpose;
      const isCursor = i === selected;
      const count = groups[purpose].length;
      const label = `${purpose} (${count} model${count !== 1 ? "s" : ""})`;

      if (isCursor) {
        process.stdout.write(chalk.cyan(`  ▶ ${label}${isActive ? chalk.gray("  (active)") : ""}\n`));
      } else {
        process.stdout.write(`    ${label}${isActive ? chalk.gray("  (active)") : ""}\n`);
      }
    }

    process.stdout.write(chalk.gray("\n  Select a purpose to see its models.\n"));
  };

  if (!process.stdin.isTTY) {
    process.stdout.write(chalk.red("\nModel picker requires a TTY. Cannot switch models in non-interactive mode.\n"));
    return null;
  }

  return new Promise((resolve) => {
    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (data: Buffer) => {
      const seq = data.toString();

      if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); render(); return; }
      if (seq === "\x1b[B") { selected = Math.min(purposes.length - 1, selected + 1); render(); return; }

      if (seq === "\r" || seq === "\n") {
        process.stdin.removeListener("data", onData);
        process.stdout.write("\x1b[2J\x1b[H");
        resolve(purposes[selected]);
        return;
      }
      if (seq === "\x1b" || seq === "\x03") {
        process.stdin.removeListener("data", onData);
        process.stdout.write("\x1b[2J\x1b[H");
        resolve(null);
        return;
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function showModelPicker(
  currentModelId: string,
  currentUrl: string,
  purpose?: string,
): Promise<ModelConfig | null> {
  const models = loadModels();
  
  // If purpose is not specified, let user select it first
  if (!purpose) {
    const selectedPurpose = await pickPurpose(models.find(m => m.modelId === currentModelId && m.url === currentUrl)?.purpose);
    if (!selectedPurpose) return null;
    purpose = selectedPurpose;
  }

  // Filter by purpose
  const filteredModels = models.filter(m => m.purpose === purpose);

  if (filteredModels.length === 0) {
    const purposeText = purpose ? ` with purpose "${purpose}"` : "";
    process.stdout.write(chalk.red(`\nNo models found${purposeText}. Add entries to models.json at the project root.\n`));
    return null;
  }

  let selected = Math.max(
    0,
    filteredModels.findIndex((m) => m.modelId === currentModelId && m.url === currentUrl),
  );

  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(chalk.bold(`  Select Model  ${chalk.gray(`(${purpose})`)}`));
    process.stdout.write("\n");
    process.stdout.write(chalk.gray("  ↑↓ navigate · Enter select · Esc cancel\n\n"));

    for (let i = 0; i < filteredModels.length; i++) {
      const isActive = filteredModels[i].modelId === currentModelId && filteredModels[i].url === currentUrl;
      const isCursor = i === selected;
      const label = `${filteredModels[i].name}  ${chalk.gray(filteredModels[i].url)}`;

      if (isCursor) {
        process.stdout.write(chalk.cyan(`  ▶ ${label}${isActive ? chalk.gray("  (active)") : ""}\n`));
      } else {
        process.stdout.write(`    ${label}${isActive ? chalk.gray("  (active)") : ""}\n`);
      }
    }

    process.stdout.write(chalk.gray("\n  Edit models.json to add or remove models.\n"));
  };

  if (!process.stdin.isTTY) {
    process.stdout.write(chalk.red("\nModel picker requires a TTY. Cannot switch models in non-interactive mode.\n"));
    return null;
  }

  return new Promise((resolve) => {
    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (data: Buffer) => {
      const seq = data.toString();

      if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); render(); return; }
      if (seq === "\x1b[B") { selected = Math.min(filteredModels.length - 1, selected + 1); render(); return; }

      if (seq === "\r" || seq === "\n") { cleanup(); resolve(filteredModels[selected]); return; }
      if (seq === "\x1b" || seq === "\x03") { cleanup(); resolve(null); return; }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdout.write("\x1b[2J\x1b[H");
    };

    process.stdin.on("data", onData);
  });
}
