import chalk from "chalk";
import { getToolOutputMode, setToolOutputMode } from "./agent.js";

type ToolOutputMode = "limited" | "some" | "all";

const TOOL_OUTPUT_MODES: { value: ToolOutputMode; label: string; desc: string }[] = [
  { value: "limited", label: "Limited", desc: "2 lines" },
  { value: "some",    label: "Some",    desc: "10 lines" },
  { value: "all",     label: "All",     desc: "unlimited" },
];

const SETTINGS = [
  { key: "tool-output", label: "Tool output verbosity", getValue: () => getToolOutputMode() },
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

export async function showSettingsPicker(): Promise<void> {
  let selected = 0;

  while (true) {
    // Top-level settings menu
    const idx = await new Promise<number | null>((resolve) => {
      renderMenu(
        "Settings",
        SETTINGS.map((s) => `${s.label}  ${chalk.gray(s.getValue())}`),
        selected,
        "↑↓ navigate · Enter open · Esc close",
      );

      const onData = (data: Buffer) => {
        const seq = data.toString();
        if (seq === "\x1b[A") { selected = Math.max(0, selected - 1); renderMenu("Settings", SETTINGS.map((s) => `${s.label}  ${chalk.gray(s.getValue())}`), selected, "↑↓ navigate · Enter open · Esc close"); return; }
        if (seq === "\x1b[B") { selected = Math.min(SETTINGS.length - 1, selected + 1); renderMenu("Settings", SETTINGS.map((s) => `${s.label}  ${chalk.gray(s.getValue())}`), selected, "↑↓ navigate · Enter open · Esc close"); return; }
        if (seq === "\r" || seq === "\n") { process.stdin.removeListener("data", onData); resolve(selected); return; }
        if (seq === "\x1b" || seq === "\x03") { process.stdin.removeListener("data", onData); resolve(null); return; }
      };
      process.stdin.on("data", onData);
    });

    if (idx === null) break;

    // Navigate into the selected setting
    if (SETTINGS[idx].key === "tool-output") {
      const current = TOOL_OUTPUT_MODES.findIndex((m) => m.value === getToolOutputMode());
      const picked = await pickFromList("Tool Output Verbosity", TOOL_OUTPUT_MODES, current);
      if (picked !== null) setToolOutputMode(TOOL_OUTPUT_MODES[picked].value);
    }
  }

  process.stdout.write("\x1b[2J\x1b[H");
}
