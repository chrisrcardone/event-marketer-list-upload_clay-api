import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserForApi } from "@/lib/auth/session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/csv/parse";
import { extractLeads, preflight } from "@/lib/csv/validate";
import { createRun, pollStep } from "@/lib/runs/orchestrate";
import { planConfigFromEnv } from "@/lib/runs/plan";
import { logEvent } from "@/lib/log";

export const maxDuration = 60;

const createSchema = z.object({
  runName: z.string().min(1).max(200),
  fileName: z.string().min(1).max(200),
  storagePath: z.string().min(1),
  columnMapping: z.record(z.string(), z.string()),
  dropChoices: z.object({
    unidentified: z.boolean(),
    malformed: z.boolean(),
    duplicates: z.boolean(),
  }),
  campaign: z.object({
    id: z.string().min(15).max(18),
    name: z.string(),
    type: z.string(),
    status: z.string(),
    members: z.number().nullable(),
  }),
  campaignMemberStatus: z.string().max(80),
});

/** Create a run: authoritative server-side re-parse from Storage — the
 *  client's parse is preview-only and never trusted (spec §8). */
export async function POST(request: Request) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const body = parsed.data;

  if (!body.storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "not your upload" }, { status: 403 });
  }

  const db = createServiceClient();
  const download = await db.storage.from("uploads").download(body.storagePath);
  if (download.error || !download.data) {
    return NextResponse.json({ error: "uploaded file not found" }, { status: 400 });
  }
  const text = await download.data.text();
  const csv = parseCsv(text);
  if (csv.rows.length === 0) {
    return NextResponse.json({ error: "the file has no data rows" }, { status: 400 });
  }
  const cfg = planConfigFromEnv();
  if (csv.rows.length > cfg.maxBatchRows) {
    return NextResponse.json(
      { error: `over the ${cfg.maxBatchRows.toLocaleString("en-US")}-row limit — split the file` },
      { status: 400 },
    );
  }

  const leads = extractLeads(csv.rows, csv.lineNumbers, body.columnMapping);
  const flight = preflight(leads, body.dropChoices);
  if (flight.clean.length === 0) {
    return NextResponse.json({ error: "no runnable rows after pre-flight" }, { status: 400 });
  }

  const created = await createRun({
    userId: user.id,
    userEmail: user.email,
    runName: body.runName,
    fileName: body.fileName,
    fileSizeBytes: text.length,
    sourceStoragePath: body.storagePath,
    campaign: body.campaign,
    campaignMemberStatus: body.campaignMemberStatus,
    totalRows: csv.rows.length,
    dropped: {
      unidentified: body.dropChoices.unidentified ? flight.unidentified.length : 0,
      malformed: body.dropChoices.malformed ? flight.malformedEmail.filter((r) => !flight.clean.some((c) => c.line === r.line)).length : 0,
      duplicates: body.dropChoices.duplicates ? flight.duplicates.length : 0,
    },
    dropChoices: body.dropChoices,
    columnMapping: body.columnMapping,
    leads: flight.clean,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 500 });

  // Kick the first unit of work now so chunks start without waiting a poll.
  await pollStep(user.id, created.runId, true);
  logEvent("run.started", { runId: created.runId, rows: flight.clean.length });
  return NextResponse.json({ runId: created.runId });
}

/** History list — reads through the session-scoped client so RLS applies. */
export async function GET() {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select(
      "id, created_at, run_name, file_name, campaign_name, status, effective_rows, written_rows, failed_rows, skipped_rows, finished_rows",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "could not load runs" }, { status: 500 });
  return NextResponse.json({ runs: data });
}
