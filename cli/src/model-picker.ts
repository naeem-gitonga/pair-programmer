import chalk from "chalk";

interface Model {
  id: string;
  object: string;
}

async function fetchModels(serverUrl: string): Promise<Model[]> {
  const res = await fetch(`${serverUrl}/v1/models`);
  const data = await res.json() as { data: Model[] };
  return data.data ?? [];
}

export async function showModelPicker(
  serverUrl: string,
  currentModel: string,
): Promise<string | null> {
  let models: Model[];

  try {
    models = await fetchModels(serverUrl);
  } catch {
    process.stdout.write(chalk.red("\nFailed to fetch models from server.\n"));
    return null;
  }

  if (models.length === 0) {
    process.stdout.write(chalk.red("\nNo models available.\n"));
    return null;
  }

  let selected = Math.max(0, models.findIndex((m) => m.id === currentModel));

  const render = () => {
    // Clear screen and draw picker
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(chalk.bold("  Select Model\n"));
    process.stdout.write(chalk.gray("  ↑↓ navigate · Enter select · Esc cancel\n\n"));

    for (let i = 0; i < models.length; i++) {
      const isCurrent = models[i].id === currentModel;
      const isSelected = i === selected;

      if (isSelected) {
        process.stdout.write(chalk.cyan(`  ▶ ${models[i].id}${isCurrent ? chalk.gray("  (active)") : ""}\n`));
      } else {
        process.stdout.write(`    ${models[i].id}${isCurrent ? chalk.gray("  (active)") : ""}\n`);
      }
    }
  };

  return new Promise((resolve) => {
    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (data: Buffer) => {
      const seq = data.toString();

      if (seq === "\x1b[A") { // Up
        selected = Math.max(0, selected - 1);
        render();
        return;
      }
      if (seq === "\x1b[B") { // Down
        selected = Math.min(models.length - 1, selected + 1);
        render();
        return;
      }
      if (seq === "\r" || seq === "\n") { // Enter
        cleanup();
        resolve(models[selected].id);
        return;
      }
      if (seq === "\x1b" || seq === "\x03") { // Esc or Ctrl+C
        cleanup();
        resolve(null);
        return;
      }
    };

    const cleanup = () => {
      try { process.stdin.setRawMode(false); } catch {}
      process.stdin.removeListener("data", onData);
      process.stdout.write("\x1b[2J\x1b[H"); // clear screen before returning
    };

    process.stdin.on("data", onData);
  });
}
