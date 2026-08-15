/**
 * Typed error taxonomy for the Clay client. Branching is by HTTP status
 * ONLY — Clay's error bodies are `{ message }` with no stable codes
 * (spec §2.7). The message is carried for logging and for mapping to
 * user-facing copy, never for control flow.
 *
 * Rate limiting is a first-class RESULT, not an exception: orchestration
 * must persist it and reschedule (serverless functions never sleep it off).
 */

export type ClayError =
  | {
      kind: "rate_limited";
      status: 429;
      /** Parsed Retry-After (seconds); null when the header is absent. */
      retryAfterSeconds: number | null;
      message: string;
    }
  | { kind: "auth"; status: 401 | 403; message: string }
  | { kind: "not_found"; status: 404; message: string }
  | { kind: "invalid_request"; status: number; message: string } // 400 / 409 / 422
  | { kind: "server"; status: number; message: string } // 5xx after retries
  | { kind: "network"; message: string }
  | { kind: "invalid_response"; message: string; issues?: unknown };

export type ClayResult<T> = { ok: true; value: T } | { ok: false; error: ClayError };

export function ok<T>(value: T): ClayResult<T> {
  return { ok: true, value };
}

export function err<T>(error: ClayError): ClayResult<T> {
  return { ok: false, error };
}

export function classifyHttpError(
  status: number,
  message: string,
  retryAfterSeconds: number | null,
): ClayError {
  if (status === 429) return { kind: "rate_limited", status, retryAfterSeconds, message };
  if (status === 401 || status === 403) return { kind: "auth", status, message };
  if (status === 404) return { kind: "not_found", status, message };
  if (status >= 500) return { kind: "server", status, message };
  return { kind: "invalid_request", status, message };
}

/** Human sentences for the screen — raw Clay strings never reach the UI. */
export function humanizeClayError(error: ClayError): string {
  switch (error.kind) {
    case "rate_limited":
      return "Clay asked us to slow down — the run pauses and resumes on its own.";
    case "auth":
      return "Clay rejected the API key. Check CLAY_API_KEY in the environment.";
    case "not_found":
      return "Clay couldn't find that routine or run. Check CLAY_ROUTINE_ID.";
    case "invalid_request":
      return "Clay rejected the request before running it.";
    case "server":
      return "Clay had a hiccup on their side. The app retries automatically.";
    case "network":
      return "Couldn't reach Clay. The app retries automatically.";
    case "invalid_response":
      return "Clay answered in a shape the app didn't expect. Nothing was lost.";
  }
}
