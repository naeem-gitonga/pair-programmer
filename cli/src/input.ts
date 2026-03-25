import chalk from "chalk";

const PROMPT = "You: ";
const SHIFT_ENTER = ["\x1b[13;2u", "\x1b[27;2;13~", "\x1b\r"];
const PASTE_INLINE_THRESHOLD = 150; // pastes shorter than this render as plain text

/** Normalize \r\n and bare \r to \n so terminal output doesn't clobber lines. */
function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export class FullScreenInput {
  private history: string[] = [];
  private historyIdx = -1;

  pause() {}
  resume() {}

  async start(onMessage: (message: string) => Promise<void>): Promise<void> {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?2004h"); // enable bracketed paste mode
    }

    process.on("SIGINT", () => {
      if (process.stdout.isTTY) process.stdout.write("\x1b[?2004l\x1b[?25h");
      process.stdout.write(chalk.gray("\nBye.\n"));
      process.exit(0);
    });

    while (true) {
      const input = await this.readLine();
      if (!input.trim()) continue;
      if (["exit", "quit"].includes(input.trim().toLowerCase())) {
        if (process.stdout.isTTY) process.stdout.write("\x1b[?2004l");
        process.stdout.write(chalk.gray("Bye.\n"));
        process.exit(0);
      }
      this.history.unshift(input);
      this.historyIdx = -1;
      try {
        await onMessage(input.trim());
      } catch (err) {
        process.stdout.write(chalk.red(`\nError: ${(err as Error).message}\n`));
      }
    }
  }

  private readLine(): Promise<string> {
    return new Promise((resolve) => {
      let buffer = "";
      let cursorPos = 0;

      // Multiple paste regions — each is an independently-collapsed indicator
      type PR = { start: number; len: number; complete: boolean };
      let pastes: PR[] = [];
      let activePaste = -1; // index of paste whose indicator cursor is on (-1 = not on any)
      let indOff = 0;       // char position within the active indicator text

      let draft = "";
      let prevLines = 1;

      const indTextFor = (p: PR) => {
        const txt = buffer.slice(p.start, p.start + p.len);
        const lc = txt.split("\n").length;
        return `[Pasted +${lc} line${lc !== 1 ? "s" : ""}, ${txt.length} chars]`;
      };
      const pasteAt    = (pos: number) => pastes.findIndex(p => p.start === pos);
      const pasteEndAt = (pos: number) => pastes.findIndex(p => p.start + p.len === pos);
      const shiftFrom  = (afterPos: number, delta: number, skip?: PR) => {
        for (const p of pastes) if (p !== skip && p.start >= afterPos) p.start += delta;
      };
      const removePaste = (idx: number) => {
        const p = pastes[idx];
        buffer = buffer.slice(0, p.start) + buffer.slice(p.start + p.len);
        const removed = p.len;
        pastes.splice(idx, 1);
        for (const q of pastes) if (q.start > p.start) q.start -= removed;
        cursorPos = p.start;
        if (activePaste >= pastes.length) activePaste = -1;
      };

      // ── helpers for bottom-anchored positioning ──────────────────────────────
      const rows = () => (process.stdout.isTTY ? process.stdout.rows : 24) || 24;
      const cols = () => (process.stdout.isTTY ? process.stdout.columns : 80) || 80;
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

      /** Count terminal rows a rendered line occupies (accounting for wrapping). */
      const lineRows = (line: string) =>
        Math.max(1, Math.ceil(stripAnsi(line).length / cols()));

      /** Move cursor to the first row of the input area (bottom-anchored). */
      const gotoInputTop = (numLines: number) => {
        const startRow = Math.max(1, rows() - numLines + 1);
        process.stdout.write(`\x1b[${startRow};1H`);
      };

      const draw = () => {
        const curs = (ch: string | undefined) => {
          const c = ch ?? " ";
          return c === "\n" ? chalk.inverse(" ") + "\n" : chalk.inverse(c);
        };

        let out = "";
        let pos = 0;
        let placed = false;

        for (const p of pastes) {
          const idx = pastes.indexOf(p);
          const isShort = p.complete && p.len < PASTE_INLINE_THRESHOLD;
          const seg = buffer.slice(pos, p.start);

          // Text segment before this paste — place cursor if it's here
          if (!placed && activePaste === -1 && cursorPos >= pos && cursorPos < p.start) {
            const cp = cursorPos - pos;
            out += seg.slice(0, cp) + curs(seg[cp]) + seg.slice(cp + 1);
            placed = true;
          } else {
            out += seg;
          }

          if (isShort) {
            // Short paste — render inline as plain text, cursor navigates through it normally
            const content = buffer.slice(p.start, p.start + p.len);
            if (!placed && activePaste === -1 && cursorPos >= p.start && cursorPos < p.start + p.len) {
              const cp = cursorPos - p.start;
              out += content.slice(0, cp) + curs(content[cp]) + content.slice(cp + 1);
              placed = true;
            } else {
              out += content;
            }
          } else {
            // Long paste — render collapsed indicator
            const ind = indTextFor(p);
            const onThis = activePaste === idx || (activePaste === -1 && cursorPos === p.start);
            if (onThis && !placed) {
              const off = activePaste === idx ? indOff : 0;
              out += chalk.dim(ind.slice(0, off)) + chalk.inverse(ind[off]) + chalk.dim(ind.slice(off + 1));
              placed = true;
            } else {
              out += chalk.dim(ind);
            }
          }

          pos = p.start + p.len;
        }

        // Remaining text after all pastes
        if (!placed) {
          const rem = buffer.slice(pos);
          const sp = cursorPos - pos;
          out += rem.slice(0, sp) + curs(rem[sp]) + rem.slice(sp + 1);
        } else {
          out += buffer.slice(pos);
        }

        const lines = out.split("\n");
        const inputLines = lines.map((l, i) => (i === 0 ? chalk.bold(PROMPT) : "     ") + l);

        // Separator line — full terminal width, thick and noticeable
        const separator = chalk.bold.cyan("━".repeat(cols()));

        // Prepend the separator; it always occupies exactly 1 terminal row
        const rendered = [separator, ...inputLines];

        // Count actual terminal rows, accounting for line wrapping
        const newPrevLines = rendered.reduce((sum, line) => sum + lineRows(line), 0);

        // Jump to the top of where the input area will be rendered (bottom-anchored)
        gotoInputTop(newPrevLines);
        process.stdout.write("\x1b[J"); // erase from here to end of screen
        process.stdout.write(rendered.join("\n"));

        prevLines = newPrevLines;
      };

      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      if (process.stdout.isTTY) process.stdout.write("\x1b[?25l");
      draw();

      const onData = (data: Buffer) => {
        const seq = data.toString();

        // ── Bracketed paste — always create a new separate indicator ──────────
        if (seq.includes("\x1b[200~")) {
          const s = seq.indexOf("\x1b[200~") + 6;
          const e = seq.indexOf("\x1b[201~");
          const content = e !== -1 ? seq.slice(s, e) : seq.slice(s);
          const at = activePaste >= 0
            ? pastes[activePaste].start + pastes[activePaste].len
            : cursorPos;
          shiftFrom(at, content.length);
          buffer = buffer.slice(0, at) + content + buffer.slice(at);
          pastes.push({ start: at, len: content.length, complete: e !== -1 });
          pastes.sort((a, b) => a.start - b.start);
          cursorPos = at + content.length;
          activePaste = -1;
          draw();
          return;
        }

        // ── Multi-chunk paste accumulation ────────────────────────────────────
        const incIdx = pastes.findIndex(p => !p.complete);
        if (incIdx >= 0) {
          const lp = pastes[incIdx];
          const at = lp.start + lp.len;
          if (seq.includes("\x1b[201~")) {
            const extra = seq.slice(0, seq.indexOf("\x1b[201~"));
            buffer = buffer.slice(0, at) + extra + buffer.slice(at);
            shiftFrom(at, extra.length, lp);
            lp.len += extra.length;
            lp.complete = true;
          } else {
            buffer = buffer.slice(0, at) + seq + buffer.slice(at);
            shiftFrom(at, seq.length, lp);
            lp.len += seq.length;
          }
          cursorPos = lp.start + lp.len;
          draw();
          return;
        }

        // ── Shift+Enter — newline ─────────────────────────────────────────────
        if (SHIFT_ENTER.some((s) => seq === s)) {
          const at = activePaste >= 0 ? pastes[activePaste].start + pastes[activePaste].len : cursorPos;
          shiftFrom(at, 1);
          buffer = buffer.slice(0, at) + "\n" + buffer.slice(at);
          cursorPos = at + 1;
          activePaste = -1;
          draw();
          return;
        }

        // ── Enter — submit ────────────────────────────────────────────────────
        if (seq === "\r" || seq === "\n") {
          // Clear just the input area, move to the last row, and emit a newline
          // so subsequent output flows naturally below — no full-screen wipe,
          // which would destroy scroll-back and truncate large pastes.
          gotoInputTop(prevLines);
          process.stdout.write("\x1b[J"); // erase input area only
          process.stdout.write(`\x1b[${rows()};1H`); // move to bottom row
          process.stdout.write("\n"); // push cursor below bottom-anchor line
          if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          // Normalize line endings before resolving so \r\n and bare \r don't
          // cause terminal lines to overwrite each other in the YOU: block.
          resolve(normalizeNewlines(buffer));
          return;
        }

        // ── Ctrl+C ────────────────────────────────────────────────────────────
        if (seq === "\x03") {
          if (process.stdout.isTTY) process.stdout.write("\x1b[?2004l\x1b[?25h");
          process.stdout.write(chalk.gray("\nBye.\n"));
          process.exit(0);
        }

        // ── Ctrl+U — clear ────────────────────────────────────────────────────
        if (seq === "\x15") {
          buffer = ""; cursorPos = 0; pastes = []; activePaste = -1; indOff = 0;
          draw();
          return;
        }

        // ── Backspace ─────────────────────────────────────────────────────────
        if (seq === "\x7f" || seq === "\b") {
          if (activePaste >= 0) {
            removePaste(activePaste); activePaste = -1;
          } else {
            const onInd = pasteAt(cursorPos);
            if (onInd >= 0) {
              removePaste(onInd);
            } else {
              const ep = pasteEndAt(cursorPos);
              if (ep >= 0) {
                removePaste(ep);
              } else if (cursorPos > 0) {
                buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
                cursorPos--;
                for (const p of pastes) if (p.start > cursorPos) p.start--;
              }
            }
          }
          draw();
          return;
        }

        // ── Delete key ────────────────────────────────────────────────────────
        if (seq === "\x1b[3~") {
          if (activePaste >= 0) {
            removePaste(activePaste); activePaste = -1;
          } else {
            const onInd = pasteAt(cursorPos);
            if (onInd >= 0) {
              removePaste(onInd);
            } else if (cursorPos < buffer.length) {
              buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
              for (const p of pastes) if (p.start > cursorPos) p.start--;
            }
          }
          draw();
          return;
        }

        // ── Arrow keys ────────────────────────────────────────────────────────
        if (seq === "\x1b[C") { // Right
          if (activePaste >= 0) {
            const len = indTextFor(pastes[activePaste]).length;
            if (indOff < len - 1) { indOff++; }
            else { cursorPos = pastes[activePaste].start + pastes[activePaste].len; activePaste = -1; indOff = 0; }
          } else {
            const pi = pasteAt(cursorPos);
            if (pi >= 0 && !(pastes[pi].complete && pastes[pi].len < PASTE_INLINE_THRESHOLD)) {
              activePaste = pi; indOff = 0;
            } else {
              cursorPos = Math.min(buffer.length, cursorPos + 1);
            }
          }
          draw(); return;
        }
        if (seq === "\x1b[D") { // Left
          if (activePaste >= 0) {
            if (indOff > 0) { indOff--; }
            else {
              activePaste = -1; indOff = 0;
              const ep = pasteEndAt(cursorPos);
              if (ep >= 0 && !(pastes[ep].complete && pastes[ep].len < PASTE_INLINE_THRESHOLD)) {
                activePaste = ep; indOff = indTextFor(pastes[ep]).length - 1; cursorPos = pastes[ep].start;
              } else if (cursorPos > 0) { cursorPos--; }
            }
          } else {
            const ep = pasteEndAt(cursorPos);
            if (ep >= 0 && !(pastes[ep].complete && pastes[ep].len < PASTE_INLINE_THRESHOLD)) {
              activePaste = ep; indOff = indTextFor(pastes[ep]).length - 1; cursorPos = pastes[ep].start;
            } else { cursorPos = Math.max(0, cursorPos - 1); }
          }
          draw(); return;
        }
        if (seq === "\x1b[A") { // Up — move line or history
          activePaste = -1; indOff = 0;
          const lines = buffer.split("\n");
          let lineStart = 0, lineIdx = 0;
          for (let i = 0; i < lines.length; i++) {
            if (cursorPos <= lineStart + lines[i].length) { lineIdx = i; break; }
            lineStart += lines[i].length + 1;
          }
          if (lineIdx > 0) {
            cursorPos = (lineStart - lines[lineIdx - 1].length - 1) + Math.min(cursorPos - lineStart, lines[lineIdx - 1].length);
            draw();
          } else if (this.historyIdx < this.history.length - 1) {
            if (this.historyIdx === -1) draft = buffer;
            this.historyIdx++;
            buffer = this.history[this.historyIdx]; cursorPos = buffer.length; pastes = [];
            draw();
          }
          return;
        }
        if (seq === "\x1b[B") { // Down — move line or history
          activePaste = -1; indOff = 0;
          const lines = buffer.split("\n");
          let lineStart = 0, lineIdx = 0;
          for (let i = 0; i < lines.length; i++) {
            if (cursorPos <= lineStart + lines[i].length) { lineIdx = i; break; }
            lineStart += lines[i].length + 1;
          }
          if (lineIdx < lines.length - 1) {
            cursorPos = (lineStart + lines[lineIdx].length + 1) + Math.min(cursorPos - lineStart, lines[lineIdx + 1].length);
            draw();
          } else if (this.historyIdx > -1) {
            this.historyIdx--;
            buffer = this.historyIdx === -1 ? draft : this.history[this.historyIdx]; cursorPos = buffer.length; pastes = [];
            draw();
          }
          return;
        }

        // ── Home / End ────────────────────────────────────────────────────────
        if (seq === "\x1b[H" || seq === "\x01") { activePaste = -1; cursorPos = 0; draw(); return; }
        if (seq === "\x1b[F" || seq === "\x05") { activePaste = -1; cursorPos = buffer.length; draw(); return; }

        // ── Ignore other escape sequences ─────────────────────────────────────
        if (seq.startsWith("\x1b")) return;

        // ── Regular character — insert at cursor ──────────────────────────────
        const at = activePaste >= 0 ? pastes[activePaste].start + pastes[activePaste].len : cursorPos;
        shiftFrom(at, seq.length);
        buffer = buffer.slice(0, at) + seq + buffer.slice(at);
        cursorPos = at + seq.length;
        activePaste = -1;
        draw();
      };

      process.stdin.on("data", onData);
    });
  }
}
