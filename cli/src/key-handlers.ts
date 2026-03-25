import chalk from "chalk";

const PASTE_INLINE_THRESHOLD = 150;

export interface PasteRegion {
  start: number;
  len: number;
  complete: boolean;
}

export interface InputState {
  buffer: string;
  cursorPos: number;
  pastes: PasteRegion[];
  activePaste: number;
  indOff: number;
  draft: string;
  history: string[];
  historyIdx: number;
  prevLines: number;
}

export interface HandlerResult {
  state: InputState;
  submitted?: boolean;
  exit?: boolean;
}

export function indTextFor(p: PasteRegion, buffer: string): string {
  const txt = buffer.slice(p.start, p.start + p.len);
  const lc = txt.split("\n").length;
  return `[Pasted +${lc} line${lc !== 1 ? "s" : ""}, ${txt.length} chars]`;
}

function pasteAt(pastes: PasteRegion[], pos: number): number {
  return pastes.findIndex(p => p.start === pos);
}

function pasteEndAt(pastes: PasteRegion[], pos: number): number {
  return pastes.findIndex(p => p.start + p.len === pos);
}

function shiftPastes(pastes: PasteRegion[], afterPos: number, delta: number, skip?: PasteRegion): PasteRegion[] {
  return pastes.map(p => (p !== skip && p.start >= afterPos) ? { ...p, start: p.start + delta } : { ...p });
}

function removePasteAt(state: InputState, idx: number): InputState {
  const p = state.pastes[idx];
  const buffer = state.buffer.slice(0, p.start) + state.buffer.slice(p.start + p.len);
  const pastes = state.pastes
    .filter((_, i) => i !== idx)
    .map(q => ({ ...q, start: q.start > p.start ? q.start - p.len : q.start }));
  const activePaste = state.activePaste >= pastes.length ? -1 : state.activePaste;
  return { ...state, buffer, pastes, cursorPos: p.start, activePaste };
}

export function handleKeySequence(
  seq: string,
  state: InputState,
  resolve: (value: string) => void,
  onData: (data: Buffer) => void
): HandlerResult {
  let { buffer, cursorPos, pastes, activePaste, indOff, draft, history, historyIdx, prevLines } = state;

  const mk = (o: Partial<InputState>): InputState =>
    ({ buffer, cursorPos, pastes, activePaste, indOff, draft, history, historyIdx, prevLines, ...o });

  // ── Bracketed paste ────────────────────────────────────────────────────
  if (seq.includes("\x1b[200~")) {
    const s = seq.indexOf("\x1b[200~") + 6;
    const e = seq.indexOf("\x1b[201~");
    const content = e !== -1 ? seq.slice(s, e) : seq.slice(s);
    const at = activePaste >= 0 ? pastes[activePaste].start + pastes[activePaste].len : cursorPos;
    const newPastes = [...shiftPastes(pastes, at, content.length), { start: at, len: content.length, complete: e !== -1 }]
      .sort((a, b) => a.start - b.start);
    return { state: mk({ buffer: buffer.slice(0, at) + content + buffer.slice(at), cursorPos: at + content.length, pastes: newPastes, activePaste: -1 }) };
  }

  // ── Multi-chunk paste accumulation ─────────────────────────────────────
  const incIdx = pastes.findIndex(p => !p.complete);
  if (incIdx >= 0) {
    const lp = pastes[incIdx];
    const at = lp.start + lp.len;
    if (seq.includes("\x1b[201~")) {
      const extra = seq.slice(0, seq.indexOf("\x1b[201~"));
      const newPastes = pastes.map((p, i) => i === incIdx ? { ...p, len: p.len + extra.length, complete: true } : (p.start >= at ? { ...p, start: p.start + extra.length } : { ...p }));
      return { state: mk({ buffer: buffer.slice(0, at) + extra + buffer.slice(at), cursorPos: at + extra.length, pastes: newPastes }) };
    } else {
      const newPastes = pastes.map((p, i) => i === incIdx ? { ...p, len: p.len + seq.length } : (p.start >= at ? { ...p, start: p.start + seq.length } : { ...p }));
      return { state: mk({ buffer: buffer.slice(0, at) + seq + buffer.slice(at), cursorPos: at + seq.length, pastes: newPastes }) };
    }
  }

  switch (seq) {
    // ── Shift+Enter — newline ───────────────────────────────────────────
    case "\x1b[13;2u":
    case "\x1b[27;2;13~":
    case "\x1b\r": {
      const at = activePaste >= 0 ? pastes[activePaste].start + pastes[activePaste].len : cursorPos;
      return { state: mk({ buffer: buffer.slice(0, at) + "\n" + buffer.slice(at), cursorPos: at + 1, pastes: shiftPastes(pastes, at, 1), activePaste: -1 }) };
    }

    // ── Enter — submit ──────────────────────────────────────────────────
    case "\r":
    case "\n": {
      if (prevLines > 1) process.stdout.write(`\x1b[${prevLines - 1}A`);
      process.stdout.write("\r\x1b[J");
      if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      resolve(buffer);
      return { state, submitted: true };
    }

    // ── Ctrl+C ──────────────────────────────────────────────────────────
    case "\x03": {
      if (process.stdout.isTTY) process.stdout.write("\x1b[?2004l\x1b[?25h");
      process.stdout.write(chalk.gray("\nBye.\n"));
      process.exit(0);
      return { state, exit: true };
    }

    // ── Ctrl+U — clear ──────────────────────────────────────────────────
    case "\x15":
      return { state: mk({ buffer: "", cursorPos: 0, pastes: [], activePaste: -1, indOff: 0 }) };

    // ── Backspace ───────────────────────────────────────────────────────
    case "\x7f":
    case "\b": {
      if (activePaste >= 0) return { state: removePasteAt(state, activePaste) };
      const onIndBS = pasteAt(pastes, cursorPos);
      if (onIndBS >= 0) return { state: removePasteAt(state, onIndBS) };
      const epBS = pasteEndAt(pastes, cursorPos);
      if (epBS >= 0) return { state: removePasteAt(state, epBS) };
      if (cursorPos > 0) {
        const newPos = cursorPos - 1;
        return { state: mk({ buffer: buffer.slice(0, newPos) + buffer.slice(cursorPos), cursorPos: newPos, pastes: pastes.map(p => ({ ...p, start: p.start > newPos ? p.start - 1 : p.start })) }) };
      }
      return { state };
    }

    // ── Delete ──────────────────────────────────────────────────────────
    case "\x1b[3~": {
      if (activePaste >= 0) return { state: removePasteAt(state, activePaste) };
      const onIndDel = pasteAt(pastes, cursorPos);
      if (onIndDel >= 0) return { state: removePasteAt(state, onIndDel) };
      if (cursorPos < buffer.length) {
        return { state: mk({ buffer: buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1), pastes: pastes.map(p => ({ ...p, start: p.start > cursorPos ? p.start - 1 : p.start })) }) };
      }
      return { state };
    }

    // ── Right ───────────────────────────────────────────────────────────
    case "\x1b[C": {
      if (activePaste >= 0) {
        const len = indTextFor(pastes[activePaste], buffer).length;
        if (indOff < len - 1) return { state: mk({ indOff: indOff + 1 }) };
        return { state: mk({ cursorPos: pastes[activePaste].start + pastes[activePaste].len, activePaste: -1, indOff: 0 }) };
      }
      const pi = pasteAt(pastes, cursorPos);
      if (pi >= 0 && !(pastes[pi].complete && pastes[pi].len < PASTE_INLINE_THRESHOLD))
        return { state: mk({ activePaste: pi, indOff: 0 }) };
      return { state: mk({ cursorPos: Math.min(buffer.length, cursorPos + 1) }) };
    }

    // ── Left ────────────────────────────────────────────────────────────
    case "\x1b[D": {
      if (activePaste >= 0) {
        if (indOff > 0) return { state: mk({ indOff: indOff - 1 }) };
        const ep = pasteEndAt(pastes, cursorPos);
        if (ep >= 0 && !(pastes[ep].complete && pastes[ep].len < PASTE_INLINE_THRESHOLD))
          return { state: mk({ activePaste: ep, indOff: indTextFor(pastes[ep], buffer).length - 1, cursorPos: pastes[ep].start }) };
        return { state: mk({ activePaste: -1, indOff: 0, cursorPos: cursorPos > 0 ? cursorPos - 1 : 0 }) };
      }
      const ep = pasteEndAt(pastes, cursorPos);
      if (ep >= 0 && !(pastes[ep].complete && pastes[ep].len < PASTE_INLINE_THRESHOLD))
        return { state: mk({ activePaste: ep, indOff: indTextFor(pastes[ep], buffer).length - 1, cursorPos: pastes[ep].start }) };
      return { state: mk({ cursorPos: Math.max(0, cursorPos - 1) }) };
    }

    // ── Up — move line or history ────────────────────────────────────────
    case "\x1b[A": {
      const lines = buffer.split("\n");
      let lineStart = 0, lineIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (cursorPos <= lineStart + lines[i].length) { lineIdx = i; break; }
        lineStart += lines[i].length + 1;
      }
      if (lineIdx > 0) {
        const newPos = (lineStart - lines[lineIdx - 1].length - 1) + Math.min(cursorPos - lineStart, lines[lineIdx - 1].length);
        return { state: mk({ cursorPos: newPos, activePaste: -1, indOff: 0 }) };
      }
      if (historyIdx < history.length - 1) {
        const newDraft = historyIdx === -1 ? buffer : draft;
        const newHistIdx = historyIdx + 1;
        const newBuf = history[newHistIdx];
        return { state: mk({ buffer: newBuf, cursorPos: newBuf.length, pastes: [], activePaste: -1, indOff: 0, draft: newDraft, historyIdx: newHistIdx }) };
      }
      return { state };
    }

    // ── Down — move line or history ──────────────────────────────────────
    case "\x1b[B": {
      const lines = buffer.split("\n");
      let lineStart = 0, lineIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (cursorPos <= lineStart + lines[i].length) { lineIdx = i; break; }
        lineStart += lines[i].length + 1;
      }
      if (lineIdx < lines.length - 1) {
        const newPos = (lineStart + lines[lineIdx].length + 1) + Math.min(cursorPos - lineStart, lines[lineIdx + 1].length);
        return { state: mk({ cursorPos: newPos, activePaste: -1, indOff: 0 }) };
      }
      if (historyIdx > -1) {
        const newHistIdx = historyIdx - 1;
        const newBuf = newHistIdx === -1 ? draft : history[newHistIdx];
        return { state: mk({ buffer: newBuf, cursorPos: newBuf.length, pastes: [], activePaste: -1, indOff: 0, historyIdx: newHistIdx }) };
      }
      return { state };
    }

    // ── Home ────────────────────────────────────────────────────────────
    case "\x1b[H":
    case "\x01":
      return { state: mk({ cursorPos: 0, activePaste: -1 }) };

    // ── End ─────────────────────────────────────────────────────────────
    case "\x1b[F":
    case "\x05":
      return { state: mk({ cursorPos: buffer.length, activePaste: -1 }) };

    default: {
      if (seq.startsWith("\x1b")) return { state }; // ignore other escapes
      // ── Regular character — insert at cursor ───────────────────────────
      const at = activePaste >= 0 ? pastes[activePaste].start + pastes[activePaste].len : cursorPos;
      return { state: mk({ buffer: buffer.slice(0, at) + seq + buffer.slice(at), cursorPos: at + seq.length, pastes: shiftPastes(pastes, at, seq.length), activePaste: -1 }) };
    }
  }
}
