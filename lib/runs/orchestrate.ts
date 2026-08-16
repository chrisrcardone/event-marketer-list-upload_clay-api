import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clayFromEnv } from "@/lib/clay/config";
import type { RoutineItem } from "@/lib/clay/client";
import type { RunResultItem } from "@/lib/clay/schemas";
import { classifyResultItem } from "@/lib/clay/routine-contract";
import { humanizeClayError } from "@/lib/clay/errors";
import type { LeadRow } from "@/lib/csv/validate";
import { planRun, planConfigFromEnv, type RunPlan } from "@/lib/runs/plan";
import type { ChunkView, RunView } from "@/lib/runs/types";
import { campaignLink, contactLink } from "@/lib/salesforce/links";
import { createServiceClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/log";

const POLL_INTERVAL_MS = () => Number(process.env.POLL_INTERVAL_MS ?? 3000) || 3000;
const MAX_CONCURRENT_CHUNKS = () => Number(process.env.MAX_CONCURRENT_CHUNKS ?? 5) || 5;
const STALL_MS = () => (Number(process.env.STALL_THRESHOLD_MINUTES ?? 10) || 10) * 60_000;
const CHUNK_STUCK_MS = () => (Number(process.env.CHUNK_STUCK_MINUTES ?? 8) || 8) * 60_000;
const MAX_CHUNK_ATTEMPTS = 3;

type Db = SupabaseClient;

/* ── creation ──────────────────────────────────────────────────────── */

export interface CreateRunArgs {
  userId: string;
  userEmail: string;
  runName: string;
  fileName: string;
  fileSizeBytes: number | null;
  sourceStoragePath: string | null;
  campaign: { id: string; name: string; type: string; status: string; members: number | null };
  campaignMemberStatus: string;
  totalRows: number;
  dropped: { unidentified: number; malformed: number; duplicates: number };
  dropChoices: Record<string, boolean>;
  columnMapping: Record<string, string>;
  leads: LeadRow[];
  retryOfRunId?: string | null;
}

export async function createRun(args: CreateRunArgs): Promise<{ runId: string } | { error: string }> {
  const db = createServiceClient();
  const cfg = planConfigFromEnv();
  const plan = planRun(args.leads.length, cfg);
  if ("rejected" in plan) return { error: plan.rejected };

  const { data: run, error } = await db
    .from("runs")
    .insert({
      user_id: args.userId,
      status: "queued",
      mode: plan.mode,
      clay_routine_id: process.env.CLAY_ROUTINE_ID ?? null,
      chunk_size: cfg.chunkSize,
      run_name: args.runName,
      file_name: args.fileName,
      file_size_bytes: args.fileSizeBytes,
      source_storage_path: args.sourceStoragePath,
      campaign_id: args.campaign.id,
      campaign_name: args.campaign.name,
      campaign_type: args.campaign.type,
      campaign_status: args.campaign.status,
      campaign_members_at_start: args.campaign.members,
      campaign_member_status: args.campaignMemberStatus || null,
      total_rows: args.totalRows,
      effective_rows: args.leads.length,
      dropped_unidentified: args.dropped.unidentified,
      dropped_malformed_email: args.dropped.malformed,
      dropped_duplicates: args.dropped.duplicates,
      drop_choices: args.dropChoices,
      column_mapping: args.columnMapping,
      retry_of_run_id: args.retryOfRunId ?? null,
      last_progress_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !run) return { error: error?.message ?? "insert failed" };

  // Input rows double as the result store: pending → written/failed/skipped.
  const rowInserts = args.leads.map((lead, i) => ({
    run_id: run.id,
    user_id: args.userId,
    item_id: `r${lead.line}`,
    original_row_number: lead.line,
    chunk_index: plan.mode === "inline" ? Math.floor(i / cfg.chunkSize) : null,
    name: `${lead.first_name} ${lead.last_name}`.trim(),
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    company_domain: lead.company_domain,
    title: lead.title,
    linkedin_url: lead.linkedin_url,
    status: "pending" as const,
  }));
  for (let i = 0; i < rowInserts.length; i += 500) {
    const { error: rowErr } = await db.from("run_rows").insert(rowInserts.slice(i, i + 500));
    if (rowErr) return { error: rowErr.message };
  }

  if (plan.mode === "inline") {
    const chunkInserts = (plan as RunPlan).chunks.map((c) => ({
      run_id: run.id,
      user_id: args.userId,
      chunk_index: c.index,
      row_start: c.rowStart,
      row_count: c.rowCount,
      status: "queued" as const,
    }));
    const { error: chunkErr } = await db.from("run_chunks").insert(chunkInserts);
    if (chunkErr) return { error: chunkErr.message };
  }

  logEvent("run.created", { runId: run.id, mode: plan.mode, rows: args.leads.length });
  return { runId: run.id };
}

/* ── the poll step: one short, serverless-safe unit of work ─────────── */

export async function pollStep(userId: string, runId: string, force = false): Promise<RunView | null> {
  const db = createServiceClient();
  const run = await loadRun(db, userId, runId);
  if (!run) return null;

  if (isTerminal(run.status)) return buildView(db, run);

  // Coalesce: one Clay poll per interval no matter how many tabs are open.
  const cutoff = new Date(Date.now() - POLL_INTERVAL_MS()).toISOString();
  const claim = await db
    .from("runs")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", runId)
    .or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`)
    .select("id");
  const claimed = (claim.data?.length ?? 0) > 0;
  if (!claimed && !force) return buildView(db, run);

  // Honor a persisted rate-limit window.
  if (run.rate_limited_until && new Date(run.rate_limited_until) > new Date()) {
    return buildView(db, run);
  }

  try {
    if (run.mode === "batch") await pollBatch(db, run);
    else await pollInline(db, run);
  } catch (cause) {
    logEvent("run.poll_error", { runId, message: cause instanceof Error ? cause.message : "unknown" });
  }

  const fresh = await loadRun(db, userId, runId);
  return fresh ? buildView(db, fresh) : null;
}

/* ── inline mode ───────────────────────────────────────────────────── */

type RunRowDb = Record<string, unknown> & { status: string };

async function pollInline(db: Db, run: RunRowDb & { id: string; user_id: string }) {
  const clay = clayFromEnv();
  const runId = run.id as string;

  const { data: chunks } = await db
    .from("run_chunks")
    .select("*")
    .eq("run_id", runId)
    .order("chunk_index");
  if (!chunks) return;

  // Extreme resilience: a chunk whose counter hasn't moved for
  // CHUNK_STUCK_MINUTES is presumed hung inside Clay (a long-tail item that
  // never reaches terminal holds the whole chunk hostage, since row data
  // only exists at terminal). Re-queue it for a fresh Clay run — Salesforce
  // writes are idempotent (existing contacts/members are found, not
  // duplicated), so a re-run converges. Capped at MAX_CHUNK_ATTEMPTS.
  for (const chunk of chunks) {
    if (chunk.status !== "running" && chunk.status !== "starting") continue;
    const lastTouch = new Date(chunk.updated_at ?? chunk.created_at).getTime();
    if (Date.now() - lastTouch <= CHUNK_STUCK_MS()) continue;

    if ((chunk.attempt ?? 1) >= MAX_CHUNK_ATTEMPTS) {
      // Attempts exhausted and still hung: a poison item must never hold a
      // run open forever. Fail the chunk honestly — its unpersisted rows
      // become readable failures and retry-failed can take another swing.
      await db
        .from("run_chunks")
        .update({
          status: "failed",
          error: { message: `No progress after ${MAX_CHUNK_ATTEMPTS} attempts — presumed hung in Clay.` },
          completed_at: new Date().toISOString(),
        })
        .eq("id", chunk.id);
      await db
        .from("run_rows")
        .update({ status: "failed", failure_reason: "Enrichment hung inside Clay — retried 3 times" })
        .eq("run_id", runId)
        .eq("chunk_index", chunk.chunk_index)
        .eq("status", "pending");
      chunk.status = "failed";
      logEvent("chunk.exhausted", { runId, chunk: chunk.chunk_index });
      continue;
    }

    const nextAttempt = ((chunk.attempt as number) ?? 1) + 1;
    await db
      .from("run_chunks")
      .update({ status: "queued", clay_run_id: null, finished_items: 0, attempt: nextAttempt })
      .eq("id", chunk.id);
    chunk.status = "queued";
    chunk.clay_run_id = null;
    chunk.attempt = nextAttempt;
    logEvent("chunk.auto_requeued", { runId, chunk: chunk.chunk_index, attempt: nextAttempt });
  }

  const active = chunks.filter((c) => c.status === "starting" || c.status === "running");
  const queued = chunks.filter((c) => c.status === "queued");

  // Start queued chunks up to the concurrency cap.
  const slots = Math.max(0, MAX_CONCURRENT_CHUNKS() - active.length);
  for (const chunk of queued.slice(0, slots)) {
    const items = await chunkItems(db, run, chunk.chunk_index as number);
    if (!items) continue;
    const started = await clay.startInlineRun(items, process.env.CLAY_WEBHOOK_ID || undefined);
    if (!started.ok) {
      if (started.error.kind === "rate_limited") {
        await setRateLimited(db, runId, started.error.retryAfterSeconds);
        return;
      }
      await db
        .from("run_chunks")
        .update({ status: "failed", error: { message: humanizeClayError(started.error) }, attempt: (chunk.attempt as number) ?? 1 })
        .eq("id", chunk.id);
      continue;
    }
    await db
      .from("run_chunks")
      .update({ status: "running", clay_run_id: started.value.routine_run_id, started_at: new Date().toISOString() })
      .eq("id", chunk.id);
    active.push({ ...chunk, status: "running", clay_run_id: started.value.routine_run_id });
    if (run.status === "queued") {
      await db.from("runs").update({ status: "running", started_at: run.started_at ?? new Date().toISOString(), last_progress_at: new Date().toISOString() }).eq("id", runId);
      run.status = "running";
    }
  }

  // Poll active chunks SEQUENTIALLY (spec §4.1) — never in parallel.
  for (const chunk of active) {
    if (!chunk.clay_run_id) continue;
    const page = await clay.getInlineResultsPage(chunk.clay_run_id as string);
    if (!page.ok) {
      if (page.error.kind === "rate_limited") {
        await setRateLimited(db, runId, page.error.retryAfterSeconds);
        return;
      }
      logEvent("chunk.poll_error", { runId, chunk: chunk.chunk_index, kind: page.error.kind });
      continue;
    }
    if (page.value.state === "in_progress") {
      const finished = page.value.progress.finished;
      if (finished !== chunk.finished_items) {
        await db
          .from("run_chunks")
          .update({ finished_items: finished, last_polled_at: new Date().toISOString() })
          .eq("id", chunk.id);
        await db.from("runs").update({ last_progress_at: new Date().toISOString() }).eq("id", runId);
      }
      continue;
    }
    // Terminal: fetch ALL pages exactly once, persist, mark complete.
    const collected = await clay.collectInlineResults(chunk.clay_run_id as string);
    if (!collected.ok || collected.value.state !== "terminal") continue;
    await persistItems(db, runId, run.user_id as string, collected.value.terminal as RunResultItem[]);
    await db
      .from("run_chunks")
      .update({ status: "complete", finished_items: chunk.row_count, completed_at: new Date().toISOString() })
      .eq("id", chunk.id);
    await refreshCounters(db, runId);
    await db.from("runs").update({ last_progress_at: new Date().toISOString() }).eq("id", runId);
  }

  // All chunks terminal?
  const { data: after } = await db.from("run_chunks").select("status,row_count,finished_items").eq("run_id", runId);
  if (after && after.every((c) => c.status === "complete" || c.status === "failed")) {
    await finishRun(db, runId);
  }
}

async function chunkItems(db: Db, run: RunRowDb & { id: string }, chunkIndex: number): Promise<RoutineItem[] | null> {
  const { data: rows } = await db
    .from("run_rows")
    .select("item_id, original_row_number, name, email, phone, company, company_domain, title, linkedin_url")
    .eq("run_id", run.id)
    .eq("chunk_index", chunkIndex)
    .order("original_row_number");
  if (!rows || rows.length === 0) return null;
  return rows.map((r) => toRoutineItem(r, run));
}

function toRoutineItem(r: Record<string, unknown>, run: RunRowDb): RoutineItem {
  const name = String(r.name ?? "").trim();
  const [first, ...rest] = name.split(/\s+/);
  return {
    id: String(r.item_id),
    inputs: {
      first_name: first ?? "",
      last_name: rest.join(" "),
      email: String(r.email ?? ""),
      phone: String(r.phone ?? ""),
      company: String(r.company ?? ""),
      company_domain: String(r.company_domain ?? ""),
      title: String(r.title ?? ""),
      linkedin_url: String(r.linkedin_url ?? ""),
      campaign_id: String(run.campaign_id ?? ""),
      campaign_name: String(run.campaign_name ?? ""),
      campaign_member_status: String(run.campaign_member_status ?? ""),
      source_event: String(run.run_name ?? ""),
      uploaded_by: String(run.uploaded_by_email ?? ""),
    },
  };
}

/* ── batch mode ────────────────────────────────────────────────────── */

async function pollBatch(db: Db, run: RunRowDb & { id: string; user_id: string }) {
  const clay = clayFromEnv();
  const runId = run.id as string;

  if (!run.clay_batch_run_id) {
    await db.from("runs").update({ status: "uploading", started_at: run.started_at ?? new Date().toISOString() }).eq("id", runId);
    const { data: rows } = await db
      .from("run_rows")
      .select("item_id, original_row_number, name, email, phone, company, title, linkedin_url")
      .eq("run_id", runId)
      .order("original_row_number");
    if (!rows) return;
    const items = rows.map((r) => toRoutineItem(r, run));
    const started = await clay.startBatchRun(items, process.env.CLAY_WEBHOOK_ID || undefined);
    if (!started.ok) {
      if (started.error.kind === "rate_limited") return setRateLimited(db, runId, started.error.retryAfterSeconds);
      return failRun(db, runId, humanizeClayError(started.error));
    }
    await db
      .from("runs")
      .update({ clay_batch_run_id: started.value.routine_run_id, status: "validating", last_progress_at: new Date().toISOString() })
      .eq("id", runId);
    return;
  }

  const status = await clay.getBatchStatus(run.clay_batch_run_id as string);
  if (!status.ok) {
    if (status.error.kind === "rate_limited") return setRateLimited(db, runId, status.error.retryAfterSeconds);
    return;
  }
  if (status.value.state === "in_progress") {
    const { finished } = status.value.progress;
    await db
      .from("runs")
      .update({ status: "running", finished_rows: finished, last_progress_at: new Date().toISOString() })
      .eq("id", runId);
    return;
  }

  const terminal = status.value.terminal;
  if (terminal.outcome === "complete") {
    await db.from("runs").update({ status: "finalizing" }).eq("id", runId);
    const items = await clay.fetchBatchResultItems(terminal.value.result_url);
    if (!items.ok) return; // retried next poll
    await persistItems(db, runId, run.user_id as string, items.value);
    await refreshCounters(db, runId);
    await finishRun(db, runId);
  } else if (terminal.outcome === "validation_failed") {
    const e = terminal.value.error;
    await db
      .from("runs")
      .update({
        status: "validation_failed",
        error: { message: e.message, total_invalid_rows: e.total_invalid_rows, details: e.details },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } else if (terminal.outcome === "processing_failed") {
    await failRun(db, runId, "Clay couldn't process this batch. Nothing was written.");
  } else {
    await failRun(db, runId, `Clay finished with an unrecognized outcome (${terminal.value.status}).`);
  }
}

/* ── shared persistence ────────────────────────────────────────────── */

async function persistItems(db: Db, runId: string, userId: string, items: RunResultItem[]) {
  // CRITICAL: PostgREST bulk upserts use the UNION of keys across the batch
  // and write NULL for keys a row omits. Mixed-shape rows in one batch
  // therefore WIPE existing columns. Every batch below is uniform-keyed:
  //  (a) outcome-only for items with no routine output (kind-1 failures) —
  //      never touches the row's identity fields;
  //  (b) full updates for items with output, whose fields echo the merged
  //      person (input-or-better) from the routine contract.
  for (let i = 0; i < items.length; i += 200) {
    const slice = items.slice(i, i + 200);

    const base = (item: RunResultItem, outcome: ReturnType<typeof classifyResultItem>) => ({
      run_id: runId,
      user_id: userId,
      item_id: item.id,
      original_row_number: Number(item.id.replace(/^r/, "")) || 0,
      status: outcome.status,
      routine_status: outcome.routineStatus,
      failure_reason: outcome.reason || null,
      payload: outcome.output ?? (item.error ? { error: item.error.message } : null),
    });

    const outcomeOnly: Array<Record<string, unknown>> = [];
    const withOutput: Array<Record<string, unknown>> = [];
    for (const item of slice) {
      const outcome = classifyResultItem(item);
      const output = outcome.output;
      if (!output) {
        outcomeOnly.push(base(item, outcome));
        continue;
      }
      const first = (output.first_name ?? "") as string;
      const last = (output.last_name ?? "") as string;
      const name = `${first} ${last}`.trim();
      withOutput.push({
        ...base(item, outcome),
        ...(name ? { name } : {}),
        ...(output.email ? { email: output.email as string } : {}),
        ...(output.phone ? { phone: output.phone as string } : {}),
        ...(output.title ? { title: output.title as string } : {}),
        ...(output.company_name ? { company: output.company_name as string } : {}),
        ...(output.company_domain ? { company_domain: output.company_domain as string } : {}),
        ...(output.linkedin_url ? { linkedin_url: output.linkedin_url as string } : {}),
        salesforce_url: contactLink(output.salesforce_contact_id as string | undefined) || null,
      });
    }

    if (outcomeOnly.length > 0) {
      const { error } = await db.from("run_rows").upsert(outcomeOnly, { onConflict: "run_id,item_id" });
      if (error) logEvent("rows.upsert_error", { runId, message: error.message });
    }
    // Rows with output still vary per-field (email found for some, not
    // others) — upsert them ONE AT A TIME so no row inherits another row's
    // key union. Batch size here is ≤100 per chunk; the extra round-trips
    // are cheap next to the enrichment they follow.
    for (const row of withOutput) {
      const { error } = await db.from("run_rows").upsert(row, { onConflict: "run_id,item_id" });
      if (error) logEvent("rows.upsert_error", { runId, message: error.message });
    }
  }
}

async function refreshCounters(db: Db, runId: string) {
  const { data } = await db.from("run_rows").select("status").eq("run_id", runId);
  if (!data) return;
  const counts = { written: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of data) counts[r.status as keyof typeof counts] = (counts[r.status as keyof typeof counts] ?? 0) + 1;
  await db
    .from("runs")
    .update({
      written_rows: counts.written,
      failed_rows: counts.failed,
      skipped_rows: counts.skipped,
      finished_rows: counts.written + counts.failed + counts.skipped,
    })
    .eq("id", runId);
}

async function finishRun(db: Db, runId: string) {
  await refreshCounters(db, runId);
  const { data: run } = await db.from("runs").select("failed_rows").eq("id", runId).single();
  const status = (run?.failed_rows ?? 0) > 0 ? "completed_with_failures" : "complete";
  await db.from("runs").update({ status, finished_at: new Date().toISOString() }).eq("id", runId);
  logEvent("run.finished", { runId, status });
}

async function failRun(db: Db, runId: string, message: string) {
  await db
    .from("runs")
    .update({ status: "failed", error: { message }, finished_at: new Date().toISOString() })
    .eq("id", runId);
}

async function setRateLimited(db: Db, runId: string, retryAfterSeconds: number | null) {
  const until = new Date(Date.now() + Math.min(300, retryAfterSeconds ?? 30) * 1000).toISOString();
  await db.from("runs").update({ rate_limited_until: until }).eq("id", runId);
  logEvent("run.rate_limited", { runId, until });
}

/* ── retry stuck chunks (the stalled banner's action) ──────────────── */

export async function retryStuckChunks(userId: string, runId: string): Promise<boolean> {
  const db = createServiceClient();
  const run = await loadRun(db, userId, runId);
  if (!run || isTerminal(run.status)) return false;
  await db
    .from("run_chunks")
    .update({ status: "queued", clay_run_id: null, finished_items: 0 })
    .eq("run_id", runId)
    .eq("status", "running");
  const { data: bump } = await db.from("run_chunks").select("attempt,id").eq("run_id", runId).eq("status", "queued");
  for (const c of bump ?? []) await db.from("run_chunks").update({ attempt: (c.attempt ?? 1) + 1 }).eq("id", c.id);
  await db
    .from("runs")
    .update({ last_progress_at: new Date().toISOString(), rate_limited_until: null, last_polled_at: null })
    .eq("id", runId);
  return true;
}

/* ── views ─────────────────────────────────────────────────────────── */

function isTerminal(status: string): boolean {
  return ["complete", "completed_with_failures", "validation_failed", "failed", "expired"].includes(status);
}

async function loadRun(db: Db, userId: string, runId: string) {
  const { data } = await db.from("runs").select("*").eq("id", runId).eq("user_id", userId).single();
  if (!data) return null;
  const { data: userRow } = await db.auth.admin.getUserById(userId);
  return { ...data, uploaded_by_email: userRow?.user?.email ?? "" };
}

export async function getRunView(userId: string, runId: string): Promise<RunView | null> {
  const db = createServiceClient();
  const run = await loadRun(db, userId, runId);
  if (!run) return null;
  return buildView(db, run);
}

async function buildView(db: Db, run: Record<string, unknown>): Promise<RunView> {
  const runId = run.id as string;
  const { data: chunkRows } = await db
    .from("run_chunks")
    .select("chunk_index,row_count,finished_items,status")
    .eq("run_id", runId)
    .order("chunk_index");
  const chunks: ChunkView[] = (chunkRows ?? []).map((c) => ({
    index: c.chunk_index,
    rowCount: c.row_count,
    finished: c.status === "complete" ? c.row_count : c.finished_items,
    status: c.status,
  }));

  const { data: failGroups } = await db
    .from("run_rows")
    .select("failure_reason")
    .eq("run_id", runId)
    .eq("status", "failed");
  const groupMap = new Map<string, number>();
  for (const r of failGroups ?? []) {
    const label = r.failure_reason || "Failed";
    groupMap.set(label, (groupMap.get(label) ?? 0) + 1);
  }

  const error = run.error as { message?: string; total_invalid_rows?: number; details?: Array<{ line_number: number; field: string; message: string }> } | null;
  const stalled =
    !isTerminal(run.status as string) &&
    (run.status === "running" || run.status === "finalizing") &&
    Boolean(run.last_progress_at) &&
    Date.now() - new Date(run.last_progress_at as string).getTime() > STALL_MS();

  return {
    id: runId,
    runName: run.run_name as string,
    fileName: run.file_name as string,
    status: run.status as RunView["status"],
    mode: (run.mode as RunView["mode"]) ?? null,
    campaignId: run.campaign_id as string,
    campaignName: run.campaign_name as string,
    campaignUrl: campaignLink(run.campaign_id as string),
    campaignMemberStatus: (run.campaign_member_status as string) ?? "",
    totalRows: run.total_rows as number,
    effectiveRows: run.effective_rows as number,
    droppedBeforeUpload:
      ((run.dropped_unidentified as number) ?? 0) +
      ((run.dropped_malformed_email as number) ?? 0) +
      ((run.dropped_duplicates as number) ?? 0),
    finishedRows: run.finished_rows as number,
    writtenRows: run.written_rows as number,
    failedRows: run.failed_rows as number,
    skippedRows: run.skipped_rows as number,
    startedAt: run.started_at as string | null,
    finishedAt: run.finished_at as string | null,
    createdAt: run.created_at as string,
    lastProgressAt: run.last_progress_at as string | null,
    rateLimitedUntil: run.rate_limited_until as string | null,
    stalled,
    chunks,
    failureGroups: [...groupMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    validationErrors:
      error?.details?.map((d) => ({ line: d.line_number, field: d.field, message: d.message })) ?? null,
    validationTotalInvalid: error?.total_invalid_rows ?? null,
    error: error?.message ?? null,
    retryOfRunId: (run.retry_of_run_id as string) ?? null,
  };
}
