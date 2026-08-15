import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { pollStep } from "@/lib/runs/orchestrate";
import { logEvent } from "@/lib/log";

export const maxDuration = 300;

const OPEN_STATUSES = ["queued", "uploading", "validating", "running", "finalizing"];

/**
 * Reconciliation (spec §4.4) — what makes the app correct when a user
 * closes their tab mid-run. Vercel Cron, every 5 minutes, CRON_SECRET
 * bearer (cron requests carry no session):
 *   · poll every open run that hasn't been polled recently
 *   · expire runs past MAX_RUN_AGE_HOURS
 * Stall detection is derived in the run view from last_progress_at.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const maxAgeHours = Number(process.env.MAX_RUN_AGE_HOURS ?? 24) || 24;
  const expiryCutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();

  const { data: expired } = await db
    .from("runs")
    .update({
      status: "expired",
      error: { message: `No progress for ${maxAgeHours} hours — expired by reconciliation.` },
      finished_at: new Date().toISOString(),
    })
    .in("status", OPEN_STATUSES)
    .lt("created_at", expiryCutoff)
    .select("id");

  const staleCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: open } = await db
    .from("runs")
    .select("id, user_id")
    .in("status", OPEN_STATUSES)
    .or(`last_polled_at.is.null,last_polled_at.lt.${staleCutoff}`)
    .limit(20);

  let polled = 0;
  for (const run of open ?? []) {
    await pollStep(run.user_id, run.id, true);
    polled++;
  }

  logEvent("cron.reconcile", { polled, expired: expired?.length ?? 0 });
  return NextResponse.json({ polled, expired: expired?.length ?? 0 });
}
