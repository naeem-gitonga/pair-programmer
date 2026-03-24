export const web_definition = {
  type: "function",
  function: {
    name: "web",
    description: "Fetch a URL and return its content, or search Google for a query and return results.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "A URL to fetch or a search query" },
      },
      required: ["input"],
    },
  },
} as const;

export async function web({ input }: ToolArgs): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "Error: TAVILY_API_KEY environment variable is not set.";

  const isUrl = /^https?:\/\//i.test(input);

  try {
    if (isUrl) {
      const res = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, urls: [input] }),
      });
      const data = await res.json() as { results?: { url: string; raw_content: string }[] };
      const result = data.results?.[0];
      if (!result) return "No content extracted.";
      return result.raw_content.slice(0, 8000);
    } else {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: input, search_depth: "basic", max_results: 5 }),
      });
      const data = await res.json() as { results?: { title: string; url: string; content: string }[] };
      if (!data.results?.length) return "No results found.";
      return data.results.map(r => `${r.title}\n${r.url}\n${r.content}`).join("\n\n");
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
