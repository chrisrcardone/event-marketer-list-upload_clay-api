import { z } from "zod";
import { err, ok, type ClayResult } from "@/lib/clay/errors";
import { clayRequest, type ClayHttpConfig, type FetchLike } from "@/lib/clay/http";
import { parseResultFile, toNdjson } from "@/lib/clay/ndjson";
import {
  batchUploadUrlResponseSchema,
  meResponseSchema,
  parseBatchTerminal,
  runInProgressSchema,
  runResultsCompleteSchema,
  runStartResponseSchema,
  type BatchTerminal,
  type MeResponse,
  type RunInProgress,
  type RunResultItem,
  type RunResultsComplete,
  type RunStartResponse,
} from "@/lib/clay/schemas";

/** One item sent to a Routine. `inputs` is REQUIRED even when empty —
 *  a row mapping to zero fields sends `{}`, never omits the key. */
export interface RoutineItem {
  id: string; // ≤ 64 chars, the app's correlation key
  inputs: Record<string, unknown>;
}

export interface ClayClientConfig extends ClayHttpConfig {
  /** function:t_… */
  routineId: string;
  /** Always request results at Clay's max page size (default 20 costs 5×). */
  resultsPageLimit?: number;
}

export type PollOutcome<TTerminal> =
  | { state: "in_progress"; progress: RunInProgress }
  | { state: "terminal"; terminal: TTerminal };

/**
 * The Clay Public API client. Fully typed, every response Zod-validated,
 * rate limits surfaced as typed results (spec §2). No UI concerns, no
 * persistence — orchestration composes this.
 */
export function createClayClient(config: ClayClientConfig) {
  const routine = encodeURIComponent(config.routineId);
  const pageLimit = config.resultsPageLimit ?? 100;
  const fetchImpl: FetchLike = config.fetchImpl ?? fetch;

  return {
    /** POST /routines/{id}/run — 1–100 items. */
    async startInlineRun(
      items: RoutineItem[],
      webhookId?: string,
    ): Promise<ClayResult<RunStartResponse>> {
      if (items.length < 1 || items.length > 100) {
        return err({
          kind: "invalid_request",
          status: 400,
          message: `inline runs take 1–100 items, got ${items.length}`,
        });
      }
      const result = await clayRequest(
        config,
        `/routines/${routine}/run`,
        { method: "POST", body: { items, ...(webhookId ? { webhook_id: webhookId } : {}) } },
        { accepted: runStartResponseSchema, ok: runStartResponseSchema },
      );
      return result.ok ? ok(result.value.body) : result;
    },

    /**
     * GET /routines/run/{id}/results — one page. 202 → in-progress counters
     * only (row data cannot exist before terminal state); 200 → complete
     * page. Inline runs have no run-level failure status (spec §2.2).
     */
    async getInlineResultsPage(
      routineRunId: string,
      cursor?: string,
    ): Promise<ClayResult<PollOutcome<RunResultsComplete>>> {
      const params = new URLSearchParams({ limit: String(pageLimit) });
      if (cursor) params.set("cursor", cursor);
      const result = await clayRequest(
        config,
        `/routines/run/${encodeURIComponent(routineRunId)}/results?${params}`,
        { method: "GET" },
        { accepted: runInProgressSchema, ok: runResultsCompleteSchema },
      );
      if (!result.ok) return result;
      return ok(
        result.value.kind === "accepted"
          ? { state: "in_progress", progress: result.value.body }
          : { state: "terminal", terminal: result.value.body },
      );
    },

    /**
     * Collect every result row of a COMPLETED inline run, following
     * `cursor` until it's absent. Call exactly once per chunk, on its
     * transition to terminal (spec §4.1) — never re-fetch a persisted chunk.
     */
    async collectInlineResults(
      routineRunId: string,
    ): Promise<ClayResult<PollOutcome<RunResultItem[]>>> {
      const items: RunResultItem[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await this.getInlineResultsPage(routineRunId, cursor);
        if (!page.ok) return page;
        if (page.value.state === "in_progress") {
          return ok({ state: "in_progress", progress: page.value.progress });
        }
        items.push(...page.value.terminal.data);
        cursor = page.value.terminal.cursor; // absent ⇒ last page
        if (!cursor) return ok({ state: "terminal", terminal: items });
      }
    },

    /** The three-call batch flow: upload-url → PUT JSONL → start. */
    async startBatchRun(
      items: RoutineItem[],
      webhookId?: string,
    ): Promise<ClayResult<RunStartResponse>> {
      const urlResult = await clayRequest(
        config,
        `/routines/${routine}/run-batch/upload-url`,
        { method: "POST", body: {} },
        { accepted: batchUploadUrlResponseSchema, ok: batchUploadUrlResponseSchema },
      );
      if (!urlResult.ok) return urlResult;
      const { upload_url, file_id } = urlResult.value.body;

      // Presigned URL: NO clay-api-key header (spec §2.3).
      try {
        const putRes = await fetchImpl(upload_url, {
          method: "PUT",
          headers: { "content-type": "application/x-ndjson" },
          body: toNdjson(items),
        });
        if (!putRes.ok) {
          return err({
            kind: "server",
            status: putRes.status,
            message: `batch file upload failed (HTTP ${putRes.status})`,
          });
        }
      } catch (cause) {
        return err({
          kind: "network",
          message: cause instanceof Error ? cause.message : "batch upload failed",
        });
      }

      const startResult = await clayRequest(
        config,
        `/routines/${routine}/run-batch/start`,
        { method: "POST", body: { file_id, ...(webhookId ? { webhook_id: webhookId } : {}) } },
        { accepted: runStartResponseSchema, ok: runStartResponseSchema },
      );
      return startResult.ok ? ok(startResult.value.body) : startResult;
    },

    /**
     * GET /routines/run-batch/{id}/results. 202 → in-progress counters;
     * 200 → one of an OPEN set of terminal shapes — unrecognized statuses
     * land in the unknown_terminal branch, never throw (spec §2.4).
     */
    async getBatchStatus(
      routineRunId: string,
    ): Promise<ClayResult<PollOutcome<BatchTerminal>>> {
      const result = await clayRequest(
        config,
        `/routines/run-batch/${encodeURIComponent(routineRunId)}/results`,
        { method: "GET" },
        { accepted: runInProgressSchema, ok: z.unknown() },
      );
      if (!result.ok) return result;
      if (result.value.kind === "accepted") {
        return ok({ state: "in_progress", progress: result.value.body });
      }
      return ok({ state: "terminal", terminal: parseBatchTerminal(result.value.body) });
    },

    /**
     * Fetch and parse a completed batch's result file. Format is
     * undocumented: JSONL and JSON array are both handled. Presigned URL —
     * no API key header.
     */
    async fetchBatchResultItems(resultUrl: string): Promise<ClayResult<RunResultItem[]>> {
      let text: string;
      try {
        const res = await fetchImpl(resultUrl, { method: "GET" });
        if (!res.ok) {
          return err({
            kind: "server",
            status: res.status,
            message: `result file fetch failed (HTTP ${res.status})`,
          });
        }
        text = await res.text();
      } catch (cause) {
        return err({
          kind: "network",
          message: cause instanceof Error ? cause.message : "result file fetch failed",
        });
      }

      try {
        const rows = parseResultFile(text);
        const items: RunResultItem[] = [];
        for (const row of rows) {
          const parsed = z
            .object({
              id: z.string(),
              status: z.enum(["complete", "failed"]).catch("complete"),
              result: z.record(z.string(), z.unknown()).optional(),
              error: z.object({ message: z.string() }).optional(),
            })
            .safeParse(row);
          if (parsed.success) items.push(parsed.data);
        }
        return ok(items);
      } catch (cause) {
        return err({
          kind: "invalid_response",
          message: cause instanceof Error ? cause.message : "unparseable result file",
        });
      }
    },

    /** GET /me — health check; proves the key, names nothing (spec §10). */
    async getMe(): Promise<ClayResult<MeResponse>> {
      const result = await clayRequest(
        config,
        `/me`,
        { method: "GET" },
        { accepted: meResponseSchema, ok: meResponseSchema },
      );
      return result.ok ? ok(result.value.body) : result;
    },
  };
}

export type ClayClient = ReturnType<typeof createClayClient>;
