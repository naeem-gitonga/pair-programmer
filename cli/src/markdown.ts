import chalk from "chalk";

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
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
      out.push(chalk.gray("─".repeat(process.stdout.columns || 80)));
      continue;
    }

    // List items
    if (/^(\s*)[-*+] /.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      const content = line.replace(/^\s*[-*+] /, "");
      out.push(indent + chalk.hex("#FFA500")("•") + " " + renderInline(content));
      continue;
    }

    // Numbered list
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1] ?? "";
      const content = line.replace(/^\d+\. /, "");
      out.push(chalk.hex("#FFA500")(num + ".") + " " + renderInline(content));
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      out.push(chalk.gray("│ ") + chalk.italic(renderInline(line.slice(2))));
      continue;
    }

    // Empty line
    if (line.trim() === "") { out.push(""); continue; }

    // Regular paragraph
    out.push(renderInline(line));
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
