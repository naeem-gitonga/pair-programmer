import chalk from "chalk";
import { getToolOutputMode, setToolOutputMode } from "./agent.js";
import { readAppConfig, writeAppConfig, type AppConfig } from "./persist.js";

type ToolOutputMode = "limited" | "some" | "all";

const TOOL_OUTPUT_MODES: { value: ToolOutputMode; label: string; desc: string }[] = [
  { value: "limited", label: "Limited", desc: "2 lines" },
  { value: "some",    label: "Some",    desc: "10 lines" },
  { value: "all",     label: "All",     desc: "unlimited" },
];

const SETTINGS = [
  { key: "tool-output",       label: "Tool output verbosity" },
  { key: "local-server-url",  label: "Local server URL" },
];

function renderMenu(title: string, items: string[], selected: number, hint = "↑↓ navigate · Enter select · Esc back") {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(chalk.bold(`  ${title}\n\n`));
  process.stdout.write(chalk.gray(`  ${hint}\n\n`));
  for (let i = 0; i < items.length; i++) {
    process.stdout.write(i === selected ? chalk.cyan(`  ▶ ${items[i]}\n`) : `    ${items[i]}\n`);
  }
}

function pickFromList<T extends { label: string; desc?: string }>(
  title: string,
  items: T[],
  currentIdx: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    let selected = currentIdx;

    const render = () => renderMenu(
      title,
      items.map((m, i) => `${m.label}  ${chalk.gray(m.desc ?? "")}${i === currentIdx ? chalk.gray("  (current)") : ""}`),
      selected,
    );

    render();

    const onData = (data: Buffer) => {
      const seq = data.toString();
      if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); render(); return; }
      if (seq === "\x1b[B") { selected = Math.min(items.length - 1, selected + 1); render(); return; }
      if (seq === "\r" || seq === "\n") { process.stdin.removeListener("data", onData); resolve(selected); return; }
      if (seq === "\x1b" || seq === "\x03") { process.stdin.removeListener("data", onData); resolve(null); return; }
    };
    process.stdin.on("data", onData);
  });
}

function promptText(label: string, current: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(chalk.bold(`  ${label}\n\n`));
    process.stdout.write(chalk.gray(`  Current: ${current || "(none)"}\n\n`));
    process.stdout.write("  New value (Enter to keep, Esc to cancel):\n  > ");

    let input = "";

    const onData = (data: Buffer) => {
      const seq = data.toString();
      if (seq === "\x1b" || seq === "\x03") {
        process.stdin.removeListener("data", onData);
        resolve(current);
        return;
      }
      if (seq === "\r" || seq === "\n") {
        process.stdin.removeListener("data", onData);
        resolve(input.trim() || current);
        return;
      }
      if (seq === "\x7f" || seq === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (seq.length === 1 && seq.charCodeAt(0) >= 32) {
        input += seq;
        process.stdout.write(seq);
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function showSettingsPicker(): Promise<Partial<AppConfig>> {
  const changes: Partial<AppConfig> = {};
  let selected = 0;
  const config = readAppConfig();

  const getValues = () => SETTINGS.map((s) => {
    if (s.key === "tool-output") return `${s.label}  ${chalk.gray(getToolOutputMode())}`;
    if (s.key === "local-server-url") return `${s.label}  ${chalk.gray(config.localServerUrl ?? "http://localhost:8004")}`;
    return s.label;
  });

  while (true) {
    const idx = await new Promise<number | null>((resolve) => {
      renderMenu("Settings", getValues(), selected, "↑↓ navigate · Enter open · Esc close");

      const onData = (data: Buffer) => {
        const seq = data.toString();
        if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); renderMenu("Settings", getValues(), selected, "↑↓ navigate · Enter open · Esc close"); return; }
        if (seq === "\x1b[B") { selected = Math.min(SETTINGS.length - 1, selected + 1); renderMenu("Settings", getValues(), selected, "↑↓ navigate · Enter open · Esc close"); return; }
        if (seq === "\r" || seq === "\n") { process.stdin.removeListener("data", onData); resolve(selected); return; }
        if (seq === "\x1b" || seq === "\x03") { process.stdin.removeListener("data", onData); resolve(null); return; }
      };
      process.stdin.on("data", onData);
    });

    if (idx === null) break;

    if (SETTINGS[idx].key === "tool-output") {
      const current = TOOL_OUTPUT_MODES.findIndex((m) => m.value === getToolOutputMode());
      const picked = await pickFromList("Tool Output Verbosity", TOOL_OUTPUT_MODES, current);
      if (picked !== null) setToolOutputMode(TOOL_OUTPUT_MODES[picked].value);
    }

    if (SETTINGS[idx].key === "local-server-url") {
      const current = config.localServerUrl ?? "http://localhost:8004";
      const newUrl = await promptText("Local Server URL", current);
      if (newUrl !== current) {
        config.localServerUrl = newUrl;
        changes.localServerUrl = newUrl;
        writeAppConfig({ localServerUrl: newUrl });
      }
    }
  }

  process.stdout.write("\x1b[2J\x1b[H");
  return changes;
}
