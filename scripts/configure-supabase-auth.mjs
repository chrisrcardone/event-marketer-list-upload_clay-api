#!/usr/bin/env node
/**
 * One-shot hosted-project auth configuration via the Supabase Management
 * API. Run after `npx supabase login` (or with SUPABASE_ACCESS_TOKEN set)
 * and after `npx supabase db push` has applied the migrations:
 *
 *   SUPABASE_PROJECT_REF=abcdefghijklmnop \
 *   SITE_URL=https://your-app.vercel.app \
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
 *   ALLOWED_EMAIL_DOMAINS=clay.com \
 *   node scripts/configure-supabase-auth.mjs
 *
 * It configures, idempotently:
 *   · site_url + redirect allow-list (prod + localhost callbacks)
 *   · the Google provider (the only sign-in method)
 *   · the before-user-created hook (layer 1 of the domain allowlist)
 *   · syncs public.allowed_email_domains from ALLOWED_EMAIL_DOMAINS
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.supabase.com";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const tokenFile = join(homedir(), ".supabase", "access-token");
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  fail("No SUPABASE_ACCESS_TOKEN and no ~/.supabase/access-token — run `npx supabase login` first.");
}

const token = accessToken();
const ref = process.env.SUPABASE_PROJECT_REF || fail("SUPABASE_PROJECT_REF is required");
const siteUrl = process.env.SITE_URL || fail("SITE_URL is required (your production URL)");
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const domains = (process.env.ALLOWED_EMAIL_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

if (domains.length === 0)
  fail("ALLOWED_EMAIL_DOMAINS is empty — the app fails closed; set at least one domain.");

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── 1. Auth config: site URL, redirects, Google, the hook ───────────────
const redirectUrls = [
  `${siteUrl.replace(/\/$/, "")}/auth/callback`,
  "http://localhost:3000/auth/callback",
];

const authPatch = {
  site_url: siteUrl.replace(/\/$/, ""),
  uri_allow_list: redirectUrls.join(","),
  external_email_enabled: false, // Google only — no magic links
  hook_before_user_created_enabled: true,
  hook_before_user_created_uri: "pg-functions://postgres/public/before_user_created_hook",
};
if (googleClientId && googleSecret) {
  authPatch.external_google_enabled = true;
  authPatch.external_google_client_id = googleClientId;
  authPatch.external_google_secret = googleSecret;
} else {
  console.log("· GOOGLE_CLIENT_ID/SECRET not provided — skipping provider config (set them and re-run).");
}

await api("PATCH", `/v1/projects/${ref}/config/auth`, authPatch);
console.log("✓ Auth config patched (site_url, redirects, before-user-created hook" +
  (googleClientId ? ", Google provider)" : ")"));

// ── 2. Sync the DB allowlist table (layer 1 + layer 4 read from it) ─────
const values = domains.map((d) => `('${d.replace(/'/g, "''")}')`).join(", ");
const sql = `
  insert into public.allowed_email_domains (domain) values ${values}
  on conflict (domain) do nothing;
  delete from public.allowed_email_domains
  where domain not in (${domains.map((d) => `'${d.replace(/'/g, "''")}'`).join(", ")});
  select domain from public.allowed_email_domains order by domain;
`;
const rows = await api("POST", `/v1/projects/${ref}/database/query`, { query: sql });
console.log(`✓ public.allowed_email_domains synced: ${JSON.stringify(rows)}`);

console.log(`
Done. Remaining manual step (Google Cloud console):
  1. https://console.cloud.google.com/apis/credentials → OAuth client (Web application)
  2. Authorized redirect URI:  https://${ref}.supabase.co/auth/v1/callback
  3. Authorized JavaScript origins: ${siteUrl} and http://localhost:3000
  4. Re-run this script with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET if you skipped them.
`);
