#!/usr/bin/env tsx
// Run: tsx cli/debug-keys.ts
// Press keys to see their raw sequences. Ctrl+C to exit.

process.stdout.write("Press keys to see sequences (Ctrl+C to exit):\n\n");
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on("data", (data: Buffer) => {
  const hex = [...data].map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(" ");
  const str = JSON.stringify(data.toString());
  process.stdout.write(`hex: ${hex}  str: ${str}\n`);

  if (data[0] === 0x03) process.exit(0); // Ctrl+C
});
