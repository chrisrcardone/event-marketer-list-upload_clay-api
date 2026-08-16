// Restore NULL-wiped rows from the uploaded source CSV, then retry the
// remaining failures through the production API.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const env = readFileSync("/Users/chriscardone/event-marketer-list-upload_clay-api/.env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));
const PARENT = "09d6e2b8-8780-473a-8b19-cc54451f7912";
const RETRY1 = "6845b281-26bf-4ebe-8fc1-8970d15ec126";
const BASE = "https://event-lead-router.vercel.app";

// 1. Load and parse the source CSV.
const { data: run } = await admin.from("runs").select("source_storage_path, user_id").eq("id", PARENT).single();
const dl = await admin.storage.from("uploads").download(run.source_storage_path);
if (dl.error) { console.error("download:", dl.error.message); process.exit(1); }
let text = await dl.data.text();
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const parsed = Papa.parse(text, { skipEmptyLines: false });
const rows = parsed.data; // rows[0] = header at CSV line 1
const header = rows[0].map((h) => String(h).trim().toLowerCase());
const col = (name) => header.findIndex((h) => h.includes(name));
const iF = col("first"), iL = col("last"), iC = col("company name") >= 0 ? col("company name") : col("company"), iD = col("domain");
console.log("columns:", { iF, iL, iC, iD });

const byLine = (line) => {
  const r = rows[line - 1] ?? [];
  return {
    name: `${String(r[iF] ?? "").trim()} ${String(r[iL] ?? "").trim()}`.trim(),
    company: String(r[iC] ?? "").trim(),
    company_domain: String(r[iD] ?? "").trim().toLowerCase(),
  };
};

// 2. Repair wiped rows in both runs.
for (const runId of [PARENT, RETRY1]) {
  const { data: wiped } = await admin
    .from("run_rows")
    .select("id, original_row_number")
    .eq("run_id", runId)
    .or("name.is.null,name.eq.");
  let fixed = 0;
  for (const row of wiped ?? []) {
    const src = byLine(row.original_row_number);
    if (!src.name && !src.company) continue;
    await admin.from("run_rows").update(src).eq("id", row.id);
    fixed++;
  }
  console.log(`${runId.slice(0, 8)}: repaired ${fixed} of ${wiped?.length ?? 0} wiped rows`);
}

// 3. Retry the first retry-run's failures (now with real identities), as the run owner.
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const owner = users.users.find((u) => u.id === run.user_id);
const link = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
const anon = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
const session = verified.data.session;
const ref = new URL(get("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
const encoded = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
const chunks = [];
for (let i = 0; i < encoded.length; i += 3180) chunks.push(encoded.slice(i, i + 3180));
const cookie = chunks.length === 1 ? `sb-${ref}-auth-token=${chunks[0]}` : chunks.map((v, i) => `sb-${ref}-auth-token.${i}=${v}`).join("; ");

const res = await fetch(`${BASE}/api/runs/${RETRY1}/retry`, { method: "POST", headers: { cookie } });
const body = await res.json();
console.log("retry-2 →", res.status, JSON.stringify(body));
if (!res.ok) process.exit(1);

const cronSecret = get("CRON_SECRET");
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 20000));
  await fetch(`${BASE}/api/cron/reconcile`, { headers: { authorization: `Bearer ${cronSecret}` } }).catch(() => {});
  const { data: rr } = await admin
    .from("runs")
    .select("status, finished_rows, written_rows, failed_rows, skipped_rows, effective_rows")
    .eq("id", body.runId)
    .single();
  console.log(`t+${(i + 1) * 20}s`, JSON.stringify(rr));
  if (["complete", "completed_with_failures", "failed", "expired", "validation_failed"].includes(rr.status)) {
    const { data: reasons } = await admin
      .from("run_rows")
      .select("failure_reason, payload")
      .eq("run_id", body.runId)
      .eq("status", "failed");
    const grouped = {};
    for (const r of reasons ?? []) {
      const k = r.failure_reason || r.payload?.error || "?";
      grouped[k] = (grouped[k] || 0) + 1;
    }
    console.log("final failure reasons:", JSON.stringify(grouped));
    break;
  }
}
