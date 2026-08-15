import { NextResponse } from "next/server";
import { requireUserForApi } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { createRun, pollStep } from "@/lib/runs/orchestrate";
import type { LeadRow } from "@/lib/csv/validate";

export const maxDuration = 60;

/** Retry-failed as a first-class action: a NEW run seeded from this run's
 *  failed rows (design §Phase 5). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;

  const db = createServiceClient();
  const { data: run } = await db.from("runs").select("*").eq("id", id).eq("user_id", user.id).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const { data: failed } = await db
    .from("run_rows")
    .select("original_row_number,name,email,phone,company,title,linkedin_url")
    .eq("run_id", id)
    .eq("status", "failed")
    .order("original_row_number");
  if (!failed || failed.length === 0) {
    return NextResponse.json({ error: "no failed rows to retry" }, { status: 400 });
  }

  const leads: LeadRow[] = failed.map((r) => {
    const name = String(r.name ?? "").trim();
    const [first, ...rest] = name.split(/\s+/);
    return {
      line: r.original_row_number,
      first_name: first ?? "",
      last_name: rest.join(" "),
      email: r.email ?? "",
      phone: r.phone ?? "",
      company: r.company ?? "",
      title: r.title ?? "",
      linkedin_url: r.linkedin_url ?? "",
    };
  });

  const created = await createRun({
    userId: user.id,
    userEmail: user.email,
    runName: `Retry — ${failed.length} failed rows`,
    fileName: run.file_name,
    fileSizeBytes: null,
    sourceStoragePath: run.source_storage_path,
    campaign: {
      id: run.campaign_id,
      name: run.campaign_name,
      type: run.campaign_type ?? "",
      status: run.campaign_status ?? "",
      members: run.campaign_members_at_start,
    },
    campaignMemberStatus: run.campaign_member_status ?? "",
    totalRows: failed.length,
    dropped: { unidentified: 0, malformed: 0, duplicates: 0 },
    dropChoices: (run.drop_choices as Record<string, boolean>) ?? {},
    columnMapping: (run.column_mapping as Record<string, string>) ?? {},
    leads,
    retryOfRunId: id,
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 500 });
  await pollStep(user.id, created.runId, true);
  return NextResponse.json({ runId: created.runId });
}
