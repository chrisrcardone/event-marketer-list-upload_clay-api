import { createHmac, timingSafeEqual } from "node:crypto";
import { webhookPayloadSchema, type WebhookPayload } from "@/lib/clay/schemas";

/**
 * Verify a Clay webhook delivery: HMAC-SHA256 of the EXACT raw request
 * body (never parse-and-restringify) with the signing secret, compared
 * timing-safely against the X-Clay-Signature header ("sha256=<hex>").
 * Pure function — testable without any HTTP machinery.
 */
export function verifyClaySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  signingSecret: string,
): boolean {
  if (!signatureHeader || !signingSecret) return false;
  const match = signatureHeader.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;

  const expectedHex = createHmac("sha256", signingSecret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(match[1], "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * Parse a verified webhook body. Test events carry `data: {}` — they parse
 * fine and simply have no routine_run_id.
 */
export function parseWebhookPayload(rawBody: string): WebhookPayload | null {
  try {
    const parsed = webhookPayloadSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
