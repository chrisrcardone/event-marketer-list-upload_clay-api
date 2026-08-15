import { z } from "zod";
import type { RunResultItem } from "@/lib/clay/schemas";

/**
 * The contract between this app and the Clay Routine (spec §3). The
 * Routine owns enrichment, dedupe, and the Salesforce campaign-member
 * write; it returns this payload per item. A fork adapts its Routine to
 * this shape (docs/routine-contract.md, Phase 6).
 */

export const routineStatusValues = [
  "added",
  "already_member",
  "enriched_only",
  "skipped_duplicate",
  "failed",
] as const;
export type RoutineStatus = (typeof routineStatusValues)[number];

export const failureReasonValues = [
  "invalid_email",
  "no_match",
  "salesforce_write_failed",
  "missing_required_field",
  "unknown",
] as const;
export type FailureReason = (typeof failureReasonValues)[number];

/** Lenient by design: unknown statuses/fields survive into raw payload. */
export const routineOutputSchema = z
  .object({
    status: z.string().optional(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    company: z.string().nullish(),
    title: z.string().nullish(),
    salesforce_contact_id: z.string().nullish(),
    salesforce_lead_id: z.string().nullish(),
    campaign_member_id: z.string().nullish(),
    failure_reason: z.string().nullish(),
  })
  .catchall(z.unknown());
export type RoutineOutput = z.infer<typeof routineOutputSchema>;

/** failure_reason tokens → the human sentences the design shows. */
export const failureReasonCopy: Record<FailureReason, string> = {
  invalid_email: "Bad email",
  no_match: "No enrichment match",
  salesforce_write_failed: "Salesforce write rejected",
  missing_required_field: "Missing a required field",
  unknown: "Failed for an unknown reason",
};

export function humanFailureReason(token: string | null | undefined): string {
  if (!token) return failureReasonCopy.unknown;
  return failureReasonCopy[token as FailureReason] ?? failureReasonCopy.unknown;
}

/** App-level rollup of one Clay item — the design's row vocabulary. */
export interface RowOutcome {
  /** written | failed | skipped — what the pill shows. */
  status: "written" | "failed" | "skipped";
  /** The Routine's own status verbatim, when the item completed. */
  routineStatus: string | null;
  /** Human sentence for the Status column; empty for clean writes. */
  reason: string;
  output: RoutineOutput | null;
}

/**
 * THE two-kinds-of-failure rule (spec §3.2, the most likely correctness
 * bug in the app): an item fails when Clay marks it `status: "failed"`,
 * OR when the item completes but the Routine's payload says
 * `status: "failed"`. Counting only the first overstates the success rate.
 */
export function classifyResultItem(item: RunResultItem): RowOutcome {
  if (item.status === "failed") {
    return {
      status: "failed",
      routineStatus: null,
      reason: "Failed inside Clay before the routine finished",
      output: null,
    };
  }

  const parsed = routineOutputSchema.safeParse(item.result ?? {});
  const output = parsed.success ? parsed.data : null;
  const routineStatus = output?.status ?? null;

  switch (routineStatus) {
    case "added":
      return { status: "written", routineStatus, reason: "", output };
    case "enriched_only":
      // Enriched but NOT written to the campaign — counting this as
      // "written" would inflate the number the marketer reports.
      return {
        status: "skipped",
        routineStatus,
        reason: "Enriched — not added to the campaign",
        output,
      };
    case "already_member":
      return { status: "skipped", routineStatus, reason: "Already in campaign", output };
    case "skipped_duplicate":
      return { status: "skipped", routineStatus, reason: "Duplicate — already processed", output };
    case "failed":
      return {
        status: "failed",
        routineStatus,
        reason: humanFailureReason(output?.failure_reason),
        output,
      };
    default:
      // Completed with an unrecognized/missing routine status: treat as a
      // write (Clay says complete) but preserve the raw status for debugging.
      return { status: "written", routineStatus, reason: "", output };
  }
}

/** Success/failure/skip counts for a set of items, both failure kinds included. */
export function countOutcomes(items: RunResultItem[]) {
  const counts = { written: 0, failed: 0, skipped: 0 };
  for (const item of items) counts[classifyResultItem(item).status]++;
  return counts;
}
