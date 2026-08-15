/**
 * Structured JSON logging with PII redaction (spec §10). This app handles
 * PII by definition: emails and phone numbers never reach a log line, and
 * the Clay API key is never logged anywhere.
 */

const EMAIL_RE = /[^\s@"']+@[^\s@"']+\.[^\s@"']+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

export function redact(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/api[_-]?key|secret|token|password/i.test(k)) out[k] = "[redacted]";
      else out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), event, ...(redactDeep(fields) as Record<string, unknown>) }),
  );
}
