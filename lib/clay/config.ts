import "server-only";
import { createClayClient, type ClayClient } from "@/lib/clay/client";

/**
 * Env-driven Clay client for server code. `server-only` makes any client-
 * bundle import a build error — the API key must never reach the browser.
 */
export function clayFromEnv(): ClayClient {
  const apiKey = process.env.CLAY_API_KEY;
  const routineId = process.env.CLAY_ROUTINE_ID;
  if (!apiKey) throw new Error("CLAY_API_KEY is not set — see .env.example");
  if (!routineId) throw new Error("CLAY_ROUTINE_ID is not set — see .env.example");
  return createClayClient({
    apiKey,
    routineId,
    baseUrl: process.env.CLAY_API_BASE_URL ?? "https://api.clay.com/public/v0",
    resultsPageLimit: Number(process.env.RESULTS_PAGE_LIMIT ?? 100),
  });
}

export function isClayConfigured(): boolean {
  return Boolean(process.env.CLAY_API_KEY && process.env.CLAY_ROUTINE_ID);
}
