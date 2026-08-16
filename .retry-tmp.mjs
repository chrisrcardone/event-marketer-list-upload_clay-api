// Fire retry-failed on the 600-row run against PRODUCTION, then drive the
// run with the cron endpoint until terminal.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync("/Users/chriscardone/event-marketer-list-upload_clay-api/.env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const BASE = "https://event-lead-router.vercel.app";
const STUCK_RUN = "09d6e2b8-8780-473a-8b19-cc54451f7912";

const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

// The stuck run belongs to Chris's own user (he uploaded it) — retry must run AS that user.
const { data: runRow } = await admin.from("runs").select("user_id").eq("id", STUCK_RUN).single();
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const owner = users.users.find((u) => u.id === runRow.user_id);
console.log("run owner:", owner.email);

const link = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
if (link.error) { console.error(link.error.message); process.exit(1); }
const anon = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
if (verified.error) { console.error("verifyOtp:", verified.error.message); process.exit(1); }
const session = verified.data.session;

const ref = new URL(get("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
const encoded = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
const chunks = [];
for (let i = 0; i < encoded.length; i += 3180) chunks.push(encoded.slice(i, i + 3180));
const cookie = chunks.length === 1
  ? `sb-${ref}-auth-token=${chunks[0]}`
  : chunks.map((v, i) => `sb-${ref}-auth-token.${i}=${v}`).join("; ");

const res = await fetch(`${BASE}/api/runs/${STUCK_RUN}/retry`, { method: "POST", headers: { cookie } });
const body = await res.json();
console.log("retry →", res.status, JSON.stringify(body));
if (!res.ok) process.exit(1);
const retryRunId = body.runId;

// Drive with the cron endpoint until terminal.
const cronSecret = get("CRON_SECRET");
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 20000));
  await fetch(`${BASE}/api/cron/reconcile`, { headers: { authorization: `Bearer ${cronSecret}` } }).catch(() => {});
  const { data: run } = await admin
    .from("runs")
    .select("status, finished_rows, written_rows, failed_rows, skipped_rows, effective_rows")
    .eq("id", retryRunId)
    .single();
  console.log(`t+${(i + 1) * 20}s`, JSON.stringify(run));
  if (["complete", "completed_with_failures", "failed", "expired", "validation_failed"].includes(run.status)) break;
}
