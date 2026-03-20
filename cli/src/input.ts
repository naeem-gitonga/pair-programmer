import chalk from "chalk";

const SHIFT_ENTER = ["\x1b[13;2u", "\x1b[27;2;13~", "\x1b\r"];
const SEP_ROWS = 1;
const MIN_INPUT_ROWS = 1;
const PROMPT = "You: ";
const CONT   = "     ";

export class FullScreenInput {
  private rows = process.stdout.rows || 24;
  private cols = process.stdout.columns || 80;
  private inputHistory: string[] = [];
  private historyIdx = -1;
  private prevInputRows = MIN_INPUT_ROWS;

  async start(onMessage: (message: string) => Promise<void>): Promise<void> {
    const cleanup = () => {
      try { process.stdin.setRawMode(false); } catch {}
      process.stdout.write("\x1b[r");  // reset scroll region
      process.stdout.write(`\x1b[${this.rows};1H\n`); // move to bottom
      process.stdout.write(chalk.gray("Bye.\n"));
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    process.stdout.on("resize", () => {
      this.rows = process.stdout.rows || 24;
      this.cols = process.stdout.columns || 80;
      this.init();
    });

    // Set raw mode once — keep it on for the lifetime of the app
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.init();

    while (true) {
      const input = await this.readInput();
      if (!input.trim()) { this.drawEmpty(); continue; }
      if (["exit", "quit"].includes(input.trim().toLowerCase())) {
        this.teardown(); break;
      }
      const lines = input.split("\n").length;
      this.clearArea(lines);
      const scrollEnd = this.rows - SEP_ROWS - MIN_INPUT_ROWS - 1;
      this.setScrollRegion(scrollEnd);
      this.moveTo(scrollEnd, 1);
      process.stdout.write("\x1b[?25h"); // ensure cursor visible before output
      try {
        await onMessage(input.trim());
      } catch (err) {
        process.stdout.write(chalk.red(`\nError: ${(err as Error).message}\n`));
      }
      this.drawEmpty();
    }
  }

  private init() {
    this.drawEmpty();
  }

  private teardown() {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdout.write("\x1b[r");
    this.moveTo(this.rows, 1);
    process.stdout.write(chalk.gray("\nBye.\n"));
  }

  private setScrollRegion(end: number) {
    process.stdout.write(`\x1b[1;${end}r`);
  }

  private moveTo(row: number, col: number) {
    process.stdout.write(`\x1b[${row};${col}H`);
  }

  private drawEmpty() {
    this.drawArea("", 0);
  }

  private clearArea(inputRows: number) {
    const sepRow = this.rows - SEP_ROWS - inputRows;
    for (let r = sepRow; r <= this.rows; r++) {
      this.moveTo(r, 1);
      process.stdout.write("\x1b[K");
    }
  }

  private drawArea(buffer: string, cursorPos: number) {
    const lines = buffer.split("\n");

    // Calculate total visual rows accounting for line wrapping
    const lineVisualRowCounts = lines.map((line, i) => {
      const pfxLen = i === 0 ? PROMPT.length : CONT.length;
      return Math.max(1, Math.ceil((pfxLen + Math.max(1, line.length)) / this.cols));
    });
    const totalVisualRows = lineVisualRowCounts.reduce((a, b) => a + b, 0);
    const inputRows = Math.max(MIN_INPUT_ROWS, totalVisualRows);

    const sepRow = this.rows - SEP_ROWS - inputRows;
    const startRow = sepRow + SEP_ROWS;

    // Clear from the furthest-back separator row (old or new) down — never above the scroll region
    const oldSepRow = this.rows - SEP_ROWS - this.prevInputRows;
    const clearFrom = Math.max(Math.min(oldSepRow, sepRow), 1);
    for (let r = clearFrom; r < this.rows; r++) {
      this.moveTo(r, 1);
      process.stdout.write("\x1b[K");
    }
    this.prevInputRows = inputRows;

    this.setScrollRegion(sepRow - 1);

    // Separator
    this.moveTo(sepRow, 1);
    process.stdout.write(chalk.cyan("─".repeat(this.cols)));

    // Compute cursor line/col
    const before = buffer.slice(0, cursorPos);
    const beforeLines = before.split("\n");
    const cursorLine = beforeLines.length - 1;
    const cursorCol  = beforeLines[beforeLines.length - 1].length;

    // Draw input lines — highlight cursor position with inverse video
    // Track visual row offset to account for wrapped lines
    let visualRow = 0;
    for (let i = 0; i < lines.length; i++) {
      const pfx = i === 0 ? chalk.bold(PROMPT) : CONT;
      const pfxLen = i === 0 ? PROMPT.length : CONT.length;
      const lineVisualRows = Math.max(1, Math.ceil((pfxLen + lines[i].length) / this.cols));

      // Clear all visual rows this line occupies
      for (let v = 0; v < lineVisualRows; v++) {
        this.moveTo(startRow + visualRow + v, 1);
        process.stdout.write("\x1b[K");
      }

      this.moveTo(startRow + visualRow, 1);
      if (i === cursorLine) {
        const pre  = lines[i].slice(0, cursorCol);
        const cur  = lines[i][cursorCol] ?? " ";
        const post = lines[i].slice(cursorCol + 1);
        process.stdout.write(pfx + pre + chalk.inverse(cur) + post);
      } else {
        process.stdout.write(pfx + lines[i]);
      }

      visualRow += lineVisualRows;
    }

    // Move terminal cursor to correct visual row (sum of visual rows before cursorLine)
    const cursorVisualRow = lineVisualRowCounts.slice(0, cursorLine).reduce((a, b) => a + b, 0);
    const prefix = cursorLine === 0 ? PROMPT.length : CONT.length;
    this.moveTo(startRow + cursorVisualRow, prefix + cursorCol + 1);
    process.stdout.write("\x1b[?25h");
  }

  private readInput(): Promise<string> {
    this.historyIdx = -1; // always reset at start of each input session
    return new Promise((resolve) => {
      let buffer = "";
      let cursorPos = 0;
      let draftBuffer = ""; // saved draft when navigating history

      const redraw = () => this.drawArea(buffer, cursorPos);

      const lines = () => buffer.split("\n");

      const posToLineCol = (pos: number) => {
        const before = buffer.slice(0, pos).split("\n");
        return { line: before.length - 1, col: before[before.length - 1].length };
      };

      const lineColToPos = (line: number, col: number) => {
        const ls = lines();
        let pos = 0;
        for (let i = 0; i < line; i++) pos += ls[i].length + 1;
        return pos + Math.min(col, ls[line]?.length ?? 0);
      };

      redraw();
      process.stdin.setRawMode(true); // ensure raw mode on each readInput
      process.stdin.resume();

      const onData = (data: Buffer) => {
        const seq = data.toString();

        // Shift+Enter — newline
        if (SHIFT_ENTER.some((s) => seq === s)) {
          buffer = buffer.slice(0, cursorPos) + "\n" + buffer.slice(cursorPos);
          cursorPos++;
          redraw();
          return;
        }

        // Enter — submit
        if (seq === "\r" || seq === "\n") {
          if (buffer.trim()) {
            this.inputHistory.unshift(buffer);
          }
          // Keep raw mode on — just swap out the listener
          process.stdin.removeListener("data", onData);
          resolve(buffer);
          return;
        }

        // Ctrl+C
        if (seq === "\x03") {
          this.teardown();
          process.exit(0);
        }

        // Ctrl+U — clear current line only
        if (seq === "\x15") {
          const { line } = posToLineCol(cursorPos);
          const ls = lines();
          const lineStart = ls.slice(0, line).reduce((a, l) => a + l.length + 1, 0);
          const lineEnd = lineStart + ls[line].length;
          buffer = buffer.slice(0, lineStart) + buffer.slice(lineEnd);
          if (buffer.endsWith("\n")) buffer = buffer.slice(0, -1);
          cursorPos = lineStart;
          redraw();
          return;
        }

        // Arrow keys
        if (seq === "\x1b[A") { // Up
          const { line, col } = posToLineCol(cursorPos);
          if (line > 0) {
            // Move cursor up within multiline buffer
            cursorPos = lineColToPos(line - 1, col);
          } else if (this.historyIdx < this.inputHistory.length - 1) {
            // Scroll back through history
            if (this.historyIdx === -1) draftBuffer = buffer;
            this.historyIdx++;
            buffer = this.inputHistory[this.historyIdx];
            cursorPos = buffer.length;
          }
          redraw(); return;
        }
        if (seq === "\x1b[B") { // Down
          const { line, col } = posToLineCol(cursorPos);
          if (line < lines().length - 1) {
            // Move cursor down within multiline buffer
            cursorPos = lineColToPos(line + 1, col);
          } else if (this.historyIdx > -1) {
            // Scroll forward through history
            this.historyIdx--;
            buffer = this.historyIdx === -1 ? draftBuffer : this.inputHistory[this.historyIdx];
            cursorPos = buffer.length;
          }
          redraw(); return;
        }
        if (seq === "\x1b[C") { // Right
          cursorPos = Math.min(buffer.length, cursorPos + 1);
          redraw(); return;
        }
        if (seq === "\x1b[D") { // Left
          cursorPos = Math.max(0, cursorPos - 1);
          redraw(); return;
        }

        // Backspace
        if (seq === "\x7f" || seq === "\b") {
          if (cursorPos > 0) {
            buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
            cursorPos--;
            redraw();
          }
          return;
        }

        // Delete key (\x1b[3~)
        if (seq === "\x1b[3~") {
          if (cursorPos < buffer.length) {
            buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
            redraw();
          }
          return;
        }

        // Ignore other escape sequences
        if (seq.startsWith("\x1b")) return;

        // Regular character — insert at cursor
        buffer = buffer.slice(0, cursorPos) + seq + buffer.slice(cursorPos);
        cursorPos += seq.length;
        redraw();
      };

      process.stdin.on("data", onData);
    });
  }
}
