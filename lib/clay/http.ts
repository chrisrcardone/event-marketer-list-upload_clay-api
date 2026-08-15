import type { ZodType } from "zod";
import {
  classifyHttpError,
  err,
  ok,
  type ClayError,
  type ClayResult,
} from "@/lib/clay/errors";
import { errorBodySchema } from "@/lib/clay/schemas";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClayHttpConfig {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Retries for 5xx / network failures (429 is never auto-retried). */
  maxRetries?: number;
  /** Base backoff in ms; test suites pass 0. */
  backoffMs?: number;
}

function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  return null;
}

async function errorMessageFrom(res: Response): Promise<string> {
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.message;
  } catch {
    // non-JSON body
  }
  return `HTTP ${res.status}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Clay API request:
 *   · clay-api-key header on every call (never logged, never re-thrown in
 *     an error message)
 *   · 5xx / network → bounded retries with exponential backoff + jitter
 *   · 429 → typed rate_limited RESULT carrying Retry-After — never thrown,
 *     never slept on (serverless: persist and reschedule instead)
 *   · 202 and 200 both surface, tagged, since Clay uses 202 for
 *     "in progress" on the results endpoints
 *   · every 2xx body is Zod-validated before it's trusted
 */
export async function clayRequest<TAccepted, TOk>(
  config: ClayHttpConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  schemas: { accepted: ZodType<TAccepted>; ok: ZodType<TOk> },
): Promise<ClayResult<{ kind: "accepted"; body: TAccepted } | { kind: "ok"; body: TOk }>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxRetries = config.maxRetries ?? 2;
  const backoffMs = config.backoffMs ?? 400;
  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;

  let lastError: ClayError = { kind: "network", message: "request never attempted" };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: init.method,
        headers: {
          "clay-api-key": config.apiKey,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    } catch (cause) {
      lastError = {
        kind: "network",
        message: cause instanceof Error ? cause.message : "fetch failed",
      };
      if (attempt < maxRetries) {
        await sleep(backoffMs * 2 ** attempt * (0.5 + Math.random() * 0.5));
        continue;
      }
      return err(lastError);
    }

    if (res.status === 202 || res.status === 200) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return err({ kind: "invalid_response", message: "Clay returned non-JSON on a 2xx" });
      }
      const schema = res.status === 202 ? schemas.accepted : schemas.ok;
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return err({
          kind: "invalid_response",
          message: `Clay ${res.status} body failed validation`,
          issues: parsed.error.issues,
        });
      }
      return ok(
        res.status === 202
          ? { kind: "accepted" as const, body: parsed.data as TAccepted }
          : { kind: "ok" as const, body: parsed.data as TOk },
      );
    }

    const message = await errorMessageFrom(res);
    lastError = classifyHttpError(res.status, message, parseRetryAfter(res));

    // Retry only server errors; 429 comes back typed for the orchestrator.
    if (lastError.kind === "server" && attempt < maxRetries) {
      await sleep(backoffMs * 2 ** attempt * (0.5 + Math.random() * 0.5));
      continue;
    }
    return err(lastError);
  }

  return err(lastError);
}
