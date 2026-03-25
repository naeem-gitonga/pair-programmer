import chalk from "chalk";

const cols = () => (process.stdout.isTTY ? process.stdout.columns : 80) || 80;

/**
 * Word-wrap a plain-text string to `width` columns, preserving any leading
 * indent on the first segment (passed as `prefix` — already printed before
 * this call, so subsequent lines need the same indent).
 */
function wordWrap(text: string, width: number, indent = ""): string[] {
  if (text.length <= width) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // If a single word exceeds width, let it overflow rather than break mid-word
      current = word;
    }
  }
  if (current) lines.push(current);
  // Join continuation lines with the indent
  return lines.length === 0 ? [""] : lines.map((l, i) => (i === 0 ? l : indent + l));
}

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end — never word-wrap code
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        inCodeBlock = false;
        out.push(chalk.gray("  ┌" + "─".repeat(Math.max(20, Math.max(...codeLines.map((l) => l.length)) + 2))));
        for (const cl of codeLines) out.push("  " + chalk.cyan(cl));
        out.push(chalk.gray("  └" + "─".repeat(Math.max(20, Math.max(...codeLines.map((l) => l.length)) + 2))));
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    if (line.startsWith("### ")) { out.push("\n" + chalk.bold(line.slice(4))); continue; }
    if (line.startsWith("## "))  { out.push("\n" + chalk.bold.underline.white(line.slice(3))); continue; }
    if (line.startsWith("# "))   { out.push("\n" + chalk.bold.underline.white(line.slice(2))); continue; }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      out.push(chalk.gray("─".repeat(cols())));
      continue;
    }

    // List items
    if (/^(\s*)[-*+] /.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      const content = line.replace(/^\s*[-*+] /, "");
      const prefix = indent + "• ";
      const wrapWidth = cols() - prefix.length;
      const wrapped = wordWrap(content, wrapWidth, " ".repeat(prefix.length));
      out.push(indent + chalk.hex("#FFA500")("•") + " " + wrapped.map(renderInline).join("\n"));
      continue;
    }

    // Numbered list
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1] ?? "";
      const content = line.replace(/^\d+\. /, "");
      const prefix = num + ". ";
      const wrapWidth = cols() - prefix.length;
      const wrapped = wordWrap(content, wrapWidth, " ".repeat(prefix.length));
      out.push(chalk.hex("#FFA500")(num + ".") + " " + wrapped.map(renderInline).join("\n"));
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const content = line.slice(2);
      const wrapWidth = cols() - 2; // "│ " prefix
      const wrapped = wordWrap(content, wrapWidth, "  ");
      out.push(wrapped.map(seg => chalk.gray("│ ") + chalk.italic(renderInline(seg))).join("\n"));
      continue;
    }

    // Empty line
    if (line.trim() === "") { out.push(""); continue; }

    // Regular paragraph — wrap to terminal width
    const wrapped = wordWrap(line, cols());
    out.push(wrapped.map(renderInline).join("\n"));
  }

  return out.join("\n");
}

function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/__([^_]+)__/g, (_, t) => chalk.bold(t))
    .replace(/\*([^*]+)\*/g, (_, t) => chalk.italic(t))
    .replace(/_([^_]+)_/g, (_, t) => chalk.italic(t))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => chalk.cyan(label) + chalk.gray(` (${url})`));
}
