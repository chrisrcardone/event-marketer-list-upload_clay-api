import { z } from "zod";

/**
 * Zod schemas for every Clay response the app reads, verified against
 * https://developers.clay.com/openapi.json on 2026-08-15 (and matching
 * docs/technical-spec.md §2). Two deliberate deviations from strictness:
 *   · `cursor` is `.optional()` — it is ABSENT on the last page; that
 *     absence is how pagination ends (spec §2.2).
 *   · Batch terminal statuses are an OPEN set per Clay's docs: parsing
 *     falls back to an "unknown terminal" branch instead of throwing.
 */

// ── Inline + batch run start ────────────────────────────────────────────
export const runStartResponseSchema = z.object({
  routine_run_id: z.string(),
  status: z.literal("in_progress"),
});
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;

// ── In-progress (202) — no row data exists before terminal state ────────
export const runInProgressSchema = z.object({
  routine_run_id: z.string(),
  total: z.number(),
  finished: z.number(),
  status: z.literal("in_progress"),
});
export type RunInProgress = z.infer<typeof runInProgressSchema>;

// ── Inline results (200 complete) ───────────────────────────────────────
export const runResultItemSchema = z.object({
  id: z.string(),
  status: z.enum(["complete", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type RunResultItem = z.infer<typeof runResultItemSchema>;

export const runResultsCompleteSchema = z.object({
  routine_run_id: z.string(),
  total: z.number(),
  finished: z.number(),
  status: z.literal("complete"),
  cursor: z.string().optional(), // absent on the last page — REQUIRED to be optional
  data: z.array(runResultItemSchema),
});
export type RunResultsComplete = z.infer<typeof runResultsCompleteSchema>;

// ── Batch upload / start ────────────────────────────────────────────────
export const batchUploadUrlResponseSchema = z.object({
  upload_url: z.string().url(),
  file_id: z.string(),
});
export type BatchUploadUrlResponse = z.infer<typeof batchUploadUrlResponseSchema>;

// ── Batch results (200 terminal — an OPEN status set) ───────────────────
export const batchCompleteSchema = z.object({
  routine_run_id: z.string(),
  total: z.number(),
  finished: z.number(),
  status: z.literal("complete"),
  result_url: z.string().url(),
});
export type BatchComplete = z.infer<typeof batchCompleteSchema>;

export const batchValidationDetailSchema = z.object({
  line_number: z.number(),
  field: z.string(),
  message: z.string(),
});
export type BatchValidationDetail = z.infer<typeof batchValidationDetailSchema>;

export const batchValidationFailedSchema = z.object({
  routine_run_id: z.string(),
  status: z.literal("validation_failed"),
  error: z.object({
    message: z.string(),
    total_invalid_rows: z.number(),
    // Clay caps details at 100 entries; total_invalid_rows carries the
    // real count — the UI must surface the truncation.
    details: z.array(batchValidationDetailSchema),
  }),
});
export type BatchValidationFailed = z.infer<typeof batchValidationFailedSchema>;

export const batchProcessingFailedSchema = z.object({
  routine_run_id: z.string(),
  status: z.literal("processing_failed"),
  error: z.object({ message: z.string() }),
});
export type BatchProcessingFailed = z.infer<typeof batchProcessingFailedSchema>;

/** Fallback branch: Clay documents the terminal set as open. */
export interface BatchUnknownTerminal {
  status: string;
  routine_run_id: string | null;
  raw: unknown;
}

export type BatchTerminal =
  | { outcome: "complete"; value: BatchComplete }
  | { outcome: "validation_failed"; value: BatchValidationFailed }
  | { outcome: "processing_failed"; value: BatchProcessingFailed }
  | { outcome: "unknown_terminal"; value: BatchUnknownTerminal };

export function parseBatchTerminal(body: unknown): BatchTerminal {
  const complete = batchCompleteSchema.safeParse(body);
  if (complete.success) return { outcome: "complete", value: complete.data };
  const validation = batchValidationFailedSchema.safeParse(body);
  if (validation.success) return { outcome: "validation_failed", value: validation.data };
  const processing = batchProcessingFailedSchema.safeParse(body);
  if (processing.success) return { outcome: "processing_failed", value: processing.data };

  const loose = z
    .object({ status: z.string().optional(), routine_run_id: z.string().optional() })
    .safeParse(body);
  return {
    outcome: "unknown_terminal",
    value: {
      status: loose.success ? (loose.data.status ?? "unknown") : "unknown",
      routine_run_id: loose.success ? (loose.data.routine_run_id ?? null) : null,
      raw: body,
    },
  };
}

// ── GET /me ─────────────────────────────────────────────────────────────
// Proves the key works; carries no email or workspace name (spec §10).
export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    cli_onboarded: z.boolean(),
  }),
  workspace: z.object({ id: z.string() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ── Webhook delivery ────────────────────────────────────────────────────
// Test events send data: {} — tolerated by design (spec §2.5).
export const webhookPayloadSchema = z.object({
  webhookId: z.string(),
  createdAt: z.string(),
  data: z
    .object({ routine_run_id: z.string().optional() })
    .catchall(z.unknown())
    .default({}),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

// ── Error body ──────────────────────────────────────────────────────────
export const errorBodySchema = z.object({ message: z.string() });
