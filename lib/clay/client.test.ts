import { describe, expect, it } from "vitest";
import { createClayClient, type RoutineItem } from "./client";
import { toNdjson, parseResultFile } from "./ndjson";
import { countOutcomes, classifyResultItem } from "./routine-contract";
import type { RunResultItem } from "./schemas";

/** Sequential fetch stub: each call consumes the next scripted response. */
function scriptedFetch(
  script: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const step = script.shift();
    if (!step) throw new Error(`unexpected fetch #${calls.length}: ${url}`);
    return step(url, init);
  };
  return { impl, calls };
}

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function client(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return createClayClient({
    apiKey: "test-key",
    routineId: "function:t_test",
    baseUrl: "https://api.clay.example/public/v0",
    fetchImpl: impl,
    backoffMs: 0,
  });
}

const items: RoutineItem[] = [
  { id: "row-1", inputs: { email: "a@b.com" } },
  { id: "row-2", inputs: {} }, // zero mapped fields still sends inputs: {}
];

describe("inline run — happy path with 202 → 200 transition and pagination", () => {
  it("starts, reports progress, then collects all pages until cursor is absent", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(202, { routine_run_id: "run_1", status: "in_progress" }),
      () => json(202, { routine_run_id: "run_1", total: 2, finished: 1, status: "in_progress" }),
      () =>
        json(200, {
          routine_run_id: "run_1",
          total: 2,
          finished: 2,
          status: "complete",
          cursor: "next-page",
          data: [{ id: "row-1", status: "complete", result: { status: "added" } }],
        }),
      () =>
        json(200, {
          routine_run_id: "run_1",
          total: 2,
          finished: 2,
          status: "complete",
          // no cursor — final page
          data: [{ id: "row-2", status: "complete", result: { status: "already_member" } }],
        }),
    ]);
    const clay = client(impl);

    const start = await clay.startInlineRun(items, "wh_1");
    expect(start.ok && start.value.routine_run_id).toBe("run_1");
    expect(calls[0].url).toBe("https://api.clay.example/public/v0/routines/function%3At_test/run");
    expect((calls[0].init?.headers as Record<string, string>)["clay-api-key"]).toBe("test-key");
    const sentBody = JSON.parse(String(calls[0].init?.body));
    expect(sentBody.items[1]).toEqual({ id: "row-2", inputs: {} });
    expect(sentBody.webhook_id).toBe("wh_1");

    const progress = await clay.collectInlineResults("run_1");
    expect(progress.ok && progress.value.state).toBe("in_progress");

    const done = await clay.collectInlineResults("run_1");
    expect(done.ok).toBe(true);
    if (done.ok && done.value.state === "terminal") {
      expect(done.value.terminal.map((r) => r.id)).toEqual(["row-1", "row-2"]);
    } else {
      throw new Error("expected terminal");
    }
    // limit=100 on every results call — never the default 20
    expect(calls[1].url).toContain("limit=100");
    expect(calls[3].url).toContain("cursor=next-page");
  });

  it("rejects >100 items locally before any network call", async () => {
    const { impl, calls } = scriptedFetch([]);
    const clay = client(impl);
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, inputs: {} }));
    const result = await clay.startInlineRun(tooMany);
    expect(!result.ok && result.error.kind).toBe("invalid_request");
    expect(calls.length).toBe(0);
  });
});

describe("two kinds of row failure (the correctness rule)", () => {
  const mixed: RunResultItem[] = [
    { id: "a", status: "complete", result: { status: "added" } },
    // kind 1: Clay itself failed the item
    { id: "b", status: "failed", error: { message: "boom" } },
    // kind 2: item completed, Routine reports a business failure
    { id: "c", status: "complete", result: { status: "failed", failure_reason: "no_match" } },
    { id: "d", status: "complete", result: { status: "already_member" } },
    // enriched_only is NOT a campaign write — never counted as written
    { id: "e", status: "complete", result: { status: "enriched_only" } },
  ];

  it("counts both failure kinds — success rate is 1/5, not 4/5", () => {
    const counts = countOutcomes(mixed);
    expect(counts).toEqual({ written: 1, failed: 2, skipped: 2 });
  });

  it("maps failure_reason tokens to the design's human copy", () => {
    const c = classifyResultItem(mixed[2]);
    expect(c.status).toBe("failed");
    expect(c.reason).toBe("No enrichment match");
    expect(classifyResultItem(mixed[3]).reason).toBe("Already in campaign");
  });
});

describe("batch run", () => {
  it("upload-url → PUT JSONL without the api key → start", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(200, { upload_url: "https://blob.example/put?sig=1", file_id: "file_9" }),
      () => new Response(null, { status: 200 }),
      () => json(202, { routine_run_id: "run_batch_1", status: "in_progress" }),
    ]);
    const clay = client(impl);
    const started = await clay.startBatchRun(items, "wh_2");
    expect(started.ok && started.value.routine_run_id).toBe("run_batch_1");

    const put = calls[1];
    expect(put.url).toBe("https://blob.example/put?sig=1");
    const putHeaders = put.init?.headers as Record<string, string>;
    expect(putHeaders["content-type"]).toBe("application/x-ndjson");
    expect(putHeaders["clay-api-key"]).toBeUndefined(); // presigned — no key
    expect(String(put.init?.body)).toBe(toNdjson(items));

    const startBody = JSON.parse(String(calls[2].init?.body));
    expect(startBody).toEqual({ file_id: "file_9", webhook_id: "wh_2" });
  });

  it("validation_failed: 340 invalid rows, details capped at 100 — truncation is visible", async () => {
    const details = Array.from({ length: 100 }, (_, i) => ({
      line_number: i + 1,
      field: "email",
      message: `bad email on line ${i + 1}`,
    }));
    const { impl } = scriptedFetch([
      () =>
        json(200, {
          routine_run_id: "run_b",
          status: "validation_failed",
          error: { message: "validation failed", total_invalid_rows: 340, details },
        }),
    ]);
    const clay = client(impl);
    const res = await clay.getBatchStatus("run_b");
    expect(res.ok).toBe(true);
    if (res.ok && res.value.state === "terminal" && res.value.terminal.outcome === "validation_failed") {
      const e = res.value.terminal.value.error;
      expect(e.total_invalid_rows).toBe(340);
      expect(e.details.length).toBe(100);
      expect(e.total_invalid_rows > e.details.length).toBe(true);
    } else {
      throw new Error("expected validation_failed terminal");
    }
  });

  it("processing_failed lands in its branch", async () => {
    const { impl } = scriptedFetch([
      () =>
        json(200, {
          routine_run_id: "run_c",
          status: "processing_failed",
          error: { message: "internal" },
        }),
    ]);
    const res = await client(impl).getBatchStatus("run_c");
    expect(res.ok && res.value.state === "terminal" && res.value.terminal.outcome).toBe(
      "processing_failed",
    );
  });

  it("an unrecognized terminal status lands in unknown_terminal, never throws", async () => {
    const { impl } = scriptedFetch([
      () => json(200, { routine_run_id: "run_d", status: "partially_complete", weird: true }),
    ]);
    const res = await client(impl).getBatchStatus("run_d");
    expect(res.ok).toBe(true);
    if (res.ok && res.value.state === "terminal") {
      expect(res.value.terminal.outcome).toBe("unknown_terminal");
      if (res.value.terminal.outcome === "unknown_terminal") {
        expect(res.value.terminal.value.status).toBe("partially_complete");
        expect(res.value.terminal.value.routine_run_id).toBe("run_d");
      }
    } else {
      throw new Error("expected terminal");
    }
  });

  it("202 on batch results reports progress counters", async () => {
    const { impl } = scriptedFetch([
      () => json(202, { routine_run_id: "run_e", total: 5000, finished: 1200, status: "in_progress" }),
    ]);
    const res = await client(impl).getBatchStatus("run_e");
    expect(res.ok && res.value.state === "in_progress" && res.value.progress.finished).toBe(1200);
  });
});

describe("rate limiting and retries", () => {
  it("429 returns a typed rate_limited result carrying Retry-After — no throw, no auto-retry", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(429, { message: "slow down" }, { "retry-after": "42" }),
    ]);
    const res = await client(impl).getInlineResultsPage("run_x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("rate_limited");
      if (res.error.kind === "rate_limited") expect(res.error.retryAfterSeconds).toBe(42);
    }
    expect(calls.length).toBe(1); // 429 is never auto-retried
  });

  it("5xx retries with backoff and succeeds on the second attempt", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(500, { message: "oops" }),
      () => json(202, { routine_run_id: "run_y", total: 10, finished: 3, status: "in_progress" }),
    ]);
    const res = await client(impl).getInlineResultsPage("run_y");
    expect(res.ok && res.value.state).toBe("in_progress");
    expect(calls.length).toBe(2);
  });

  it("gives up after maxRetries on persistent 5xx with a typed server error", async () => {
    const { impl, calls } = scriptedFetch([
      () => json(503, { message: "down" }),
      () => json(503, { message: "down" }),
      () => json(503, { message: "down" }),
    ]);
    const res = await client(impl).getInlineResultsPage("run_z");
    expect(!res.ok && res.error.kind).toBe("server");
    expect(calls.length).toBe(3); // initial + 2 retries
  });
});

describe("result file parsing (format undocumented — both shapes handled)", () => {
  const rows = [
    { id: "r1", status: "complete", result: { status: "added" } },
    { id: "r2", status: "failed", error: { message: "x" } },
  ];

  it("parses JSONL", () => {
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    expect(parseResultFile(text)).toHaveLength(2);
  });

  it("parses a JSON array", () => {
    expect(parseResultFile(JSON.stringify(rows))).toHaveLength(2);
  });

  it("parses empty content as no rows", () => {
    expect(parseResultFile("")).toEqual([]);
    expect(parseResultFile("\n\n")).toEqual([]);
  });

  it("fetchBatchResultItems validates items from either format, without the api key", async () => {
    const { impl, calls } = scriptedFetch([
      () =>
        new Response(rows.map((r) => JSON.stringify(r)).join("\n"), {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        }),
    ]);
    const res = await client(impl).fetchBatchResultItems("https://files.example/result?sig=2");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.map((r) => r.id)).toEqual(["r1", "r2"]);
    }
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers["clay-api-key"]).toBeUndefined();
  });
});

describe("GET /me", () => {
  it("validates the health-check shape", async () => {
    const { impl } = scriptedFetch([
      () => json(200, { user: { id: "u1", name: null, cli_onboarded: true }, workspace: { id: "w1" } }),
    ]);
    const res = await client(impl).getMe();
    expect(res.ok && res.value.workspace.id).toBe("w1");
  });
});
