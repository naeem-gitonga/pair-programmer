import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { execSync } from "child_process";

function mimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };
  return map[ext] ?? "image/png";
}

export const analyze_media_definition = {
  type: "function",
  function: {
    name: "analyze_media",
    description: "Analyze an image or video file using vision AI. Use this when the user asks about images, screenshots, diagrams, or video content. The media_path can be a filename (will be searched for) or absolute path.",
    parameters: {
      type: "object",
      properties: {
        media_path: { type: "string", description: "Filename or path to the image or video file" },
        query: { type: "string", description: "Question or instruction about the media" },
      },
      required: ["media_path", "query"],
    },
  },
} as const;

export async function analyzeMedia({ media_path, query }: ToolArgs): Promise<string> {
  const serverUrl = process.env.SMOLVLM_SERVER_URL || "http://localhost:8005";
  
  try {
    let fullPath = media_path;
    
    // If it's not an absolute path or doesn't start with ~, search for it
    if (!media_path.startsWith("/") && !media_path.startsWith("~/")) {
      // Collect candidate directories: walk up from cwd AND from VS Code context file
      const candidateDirs = new Set<string>();
      const addAncestors = (start: string) => {
        let d = start;
        while (d !== dirname(d)) { candidateDirs.add(d); d = dirname(d); }
      };
      addAncestors(process.cwd());
      try {
        const ctx = JSON.parse(readFileSync(join(homedir(), ".pair-programmer", "context.json"), "utf-8"));
        if (ctx.file) addAncestors(dirname(ctx.file));
      } catch { /* no context */ }

      // 1. Fast path: check each ancestor directory directly
      let found: string | null = null;
      for (const dir of candidateDirs) {
        const candidate = resolve(dir, media_path);
        if (existsSync(candidate)) { found = candidate; break; }
      }

      // 2. Recursive search from $HOME as last resort
      if (!found) {
        try {
          const result = execSync(
            `find '${homedir()}' -not -path '*/node_modules/*' -not -path '*/.git/*' -name '${media_path}' 2>/dev/null | head -5`,
            { encoding: "utf-8", timeout: 15_000 }
          ).trim();
          const lines = result.split("\n").filter(Boolean);
          if (lines.length === 1) found = lines[0];
          else if (lines.length > 1) {
            return `Multiple files matching "${media_path}":\n${lines.map(l => `  - ${l}`).join("\n")}\nPlease specify the full path.`;
          }
        } catch { /* ignore */ }
      }

      if (!found) return `Error: File not found: ${media_path}`;
      fullPath = found;
    }
    
    // Check file exists
    execSync(`test -f "${fullPath}"`, { stdio: "pipe" });
    
    // Call vLLM API (no Bearer token needed - closed loop)
    const response = await fetch(`${serverUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "/models/smolvlm2",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: query },
            { type: "image_url", image_url: { url: `data:${mimeType(fullPath)};base64,${readFileSync(fullPath).toString("base64")}` } },
          ],
        }],
        max_tokens: 512,
        temperature: 0.0,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return `Error calling SmolVLM2: ${response.status} ${errorText}`;
    }
    
    const data = await response.json();
    return data.choices[0].message.content || "No analysis generated.";
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
