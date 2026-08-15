import { NextResponse } from "next/server";
import { parseWebhookPayload, verifyClaySignature } from "@/lib/clay/webhook";
import { createServiceClient } from "@/lib/supabase/server";
import { pollStep } from "@/lib/runs/orchestrate";
import { logEvent } from "@/lib/log";

export const maxDuration = 60;

/**
 * Clay run-finished webhook. PUBLIC route (excluded from the auth proxy) —
 * HMAC signature over the EXACT raw body is the only accepted credential
 * (spec §2.5). Webhooks are a latency optimization: everything here also
 * happens via polling, so failures are safe.
 */
export async function POST(request: Request) {
  const secret = process.env.CLAY_WEBHOOK_SIGNING_SECRET ?? "";
  if (!secret) {
    // Polling-only deployment: acknowledge and ignore.
    return NextResponse.json({ ok: true, mode: "polling-only" });
  }

  const rawBody = await request.text(); // BEFORE any JSON parsing — the HMAC covers these bytes
  const signature = request.headers.get("x-clay-signature");
  if (!verifyClaySignature(rawBody, signature, secret)) {
    logEvent("webhook.bad_signature", {});
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payload = parseWebhookPayload(rawBody);
  if (!payload) return NextResponse.json({ error: "unparseable" }, { status: 400 });

  const routineRunId = payload.data.routine_run_id;
  if (!routineRunId) {
    // Test event (data: {}) — tolerated by design.
    return NextResponse.json({ ok: true, test: true });
  }

  // The id alone doesn't say inline-or-batch (spec §2.5): we persisted run
  // mode at start, so look it up both ways and mark the run dirty.
  const db = createServiceClient();
  const { data: chunk } = await db
    .from("run_chunks")
    .select("run_id, user_id")
    .eq("clay_run_id", routineRunId)
    .maybeSingle();
  let runId = chunk?.run_id as string | undefined;
  let userId = chunk?.user_id as string | undefined;
  if (!runId) {
    const { data: batchRun } = await db
      .from("runs")
      .select("id, user_id")
      .eq("clay_batch_run_id", routineRunId)
      .maybeSingle();
    runId = batchRun?.id;
    userId = batchRun?.user_id;
  }
  if (!runId || !userId) return NextResponse.json({ ok: true, unknown_run: true });

  // Short-circuit the wait: clear the coalescing claim and poll now.
  await db.from("runs").update({ last_polled_at: null }).eq("id", runId);
  await pollStep(userId, runId, true);
  logEvent("webhook.processed", { runId });
  return NextResponse.json({ ok: true });
}
