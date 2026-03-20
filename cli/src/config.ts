export const SERVER_URL = process.env.LLM_SERVER_URL ?? "http://localhost:8004";
export const MODEL_NAME = process.env.LLM_MODEL_NAME ?? "local";
export const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS ?? "8192", 10);
export const TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE ?? "0.7");
