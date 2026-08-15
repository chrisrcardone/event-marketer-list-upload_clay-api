# Technical Specification — Event Lead Router

**Repository:** https://github.com/chrisrcardone/event-marketer-list-upload_clay-api
**Host:** Vercel
**Status:** v1 spec, drafted against Clay Public API v0 as documented at developers.clay.com (fetched 2026-08-15)

---

## 1. What it does

An event marketer uploads a CSV of event leads. The app runs those rows through a Clay Routine (a custom function built in the Clay UI) that enriches each person and writes them into a named Salesforce campaign. The app tracks the run, surfaces progress and failures, and produces a downloadable result set with Salesforce deep links.

**Division of responsibility:**

| Concern | Owner |
| --- | --- |
| CSV parsing, validation, column mapping | This app (client + server) |
| Enrichment, dedupe, Salesforce campaign member write | Clay Routine |
| Run orchestration, chunking, progress tracking, persistence | This app (server) |
| Auth, access control | This app (Google OAuth + domain allowlist) |
| Result presentation, export | This app (client) |

Clay's public API has **no Salesforce endpoints**. The Routine must own the Salesforce write and return the resulting record IDs. This app never talks to Salesforce for writes — only to build deep links, and optionally for read-only campaign lookup.

---

## 2. Clay Public API — verified contract

Base URL: `https://api.clay.com/public/v0`
Auth header: `clay-api-key: <key>` on every request. Server-side only. Never in client code, logs, or analytics.
Routine ID format for custom functions: `function:t_...` (get it from app.clay.com/functions → your function → Details → enable **API** → copy the `t_...` id).

### 2.1 Inline run — up to 100 items

```
POST /routines/{routine_id}/run
```

Request:
```json
{
  "items": [
    { "id": "row-1", "inputs": { "email": "a@b.com", "first_name": "Ada" } }
  ],
  "webhook_id": "wh_abc123"
}
```

- `items`: 1–100 entries. `id` is your own correlation key, max 64 chars, **required**. `inputs` is a free-form object matching the Routine's input schema and is also **required** — a row that maps to zero fields must send `"inputs": {}`, not omit the key, or the request 400s.
- `webhook_id` optional, max 64 chars.

Response `202`:
```json
{ "routine_run_id": "run_abc123", "status": "in_progress" }
```

Errors: `400`, `401`, `403`, `404`, `429`.

### 2.2 Inline run results

```
GET /routines/run/{routine_run_id}/results?cursor=&limit=
```

`limit` default 20, max 100. `cursor` for pagination.

**`202` while running — no row data:**
```json
{ "routine_run_id": "run_abc123", "total": 100, "finished": 42, "status": "in_progress" }
```

**`200` on completion:**
```json
{
  "routine_run_id": "run_abc123",
  "total": 100,
  "finished": 100,
  "status": "complete",
  "cursor": "…",
  "data": [
    { "id": "row-1", "status": "complete", "result": { } },
    { "id": "row-2", "status": "failed", "error": { "message": "…" } }
  ]
}
```

Per-item `status` is `complete` or `failed`.

**`cursor` is optional, not guaranteed.** It is absent on the last page — its absence is how you know pagination is done. Zod-parse it as `.optional()` or every final page throws.

**Always pass `limit=100`.** The default is 20, so fetching one completed 100-item chunk costs **five GETs plus cursor-looping**, not one. At the default this quintuples read volume on exactly the path §4.1 identifies as the primary rate-limit risk.

`RunResultsComplete.status` is `const: "complete"` — **inline runs have no documented run-level failure status.** They cannot return `validation_failed` or `processing_failed`. An inline chunk can only fail via an HTTP error on the run/results call or via per-item `status: "failed"`. The open-terminal-status handling in §2.4 applies to **batch runs only**.

> **This is the single most important API fact for this app.** While a run is in progress you get only `finished` / `total`. Row-level results are readable only after the run reaches a terminal state.

### 2.3 Batch run — large files

Three calls:

```
POST /routines/{routine_id}/run-batch/upload-url
  → 200 { "upload_url": "https://…", "file_id": "file_abc123" }

PUT {upload_url}
  Content-Type: application/x-ndjson
  body: JSONL, one item per line — { "id": "row-1", "inputs": { … } }
  (presigned URL — do NOT send the clay-api-key header)

POST /routines/{routine_id}/run-batch/start
  { "file_id": "file_abc123", "webhook_id": "wh_abc123" }
  → 202 { "routine_run_id": "run_xyz789", "status": "in_progress" }
```

### 2.4 Batch run results

```
GET /routines/run-batch/{routine_run_id}/results
```

**`202` in progress:** `{ routine_run_id, total, finished, status: "in_progress" }`

**`200` terminal — one of three shapes:**

`complete`:
```json
{ "routine_run_id": "…", "total": 5000, "finished": 5000, "status": "complete", "result_url": "https://…" }
```
Results are a **file at `result_url`**, not inline JSON. Fetch and parse it server-side.

`validation_failed`:
```json
{
  "routine_run_id": "…",
  "status": "validation_failed",
  "error": {
    "message": "…",
    "total_invalid_rows": 340,
    "details": [ { "line_number": 12, "field": "email", "message": "…" } ]
  }
}
```
`details` is capped at 100 entries. Surface the truncation to the user.

`processing_failed`:
```json
{ "routine_run_id": "…", "status": "processing_failed", "error": { "message": "…" } }
```

**Treat the terminal status set as open.** Clay's docs explicitly say not to assume it's closed. Any unrecognized terminal `status` must land in a handled "unknown terminal outcome" branch, not throw. (Batch only — see §2.2.)

**The 50,000-row ceiling is an inference, not a stated API limit.** It appears only as "runs that avoid the 50,000 row limit" in Workflows-facing prose, and is absent from the OpenAPI schema entirely. Treat it as a conservative default (`MAX_BATCH_ROWS`), not a hard constant, and don't build logic that depends on the exact number.

### 2.4b Endpoints that do not exist

There is **no REST endpoint to list runs, get a run's metadata, or cancel a run.** Those exist only in the CLI (`clay routines runs list` / `get`). Consequences:

- The app's own Postgres is the sole record of what runs exist. Reconciliation (§4.4) and retry (§5.3) depend entirely on it; there is no way to recover run state from Clay if the database is lost.
- No cancel means a started run cannot be stopped. The UI must not offer a cancel button — at most "abandon" (stop polling, mark abandoned locally), and it should say what that does and doesn't do.
- `webhooks.md` mentions `clay routines runs get` fetches results "for either mode." That's the CLI's convenience, not an API capability — hence the persist-the-run-mode requirement in §2.5.

### 2.5 Webhooks

Registration is **CLI-only** as documented — there is no documented REST endpoint for creating a webhook. One-time setup step:

```
clay webhooks create https://<your-vercel-domain>/api/webhooks/clay
→ { "id": "wh_abc123", "url": "…", "createdAt": "…", "signingSecret": "whsec_…" }
```

The `signingSecret` is returned **once**. Capture it into env immediately.

Delivery: signed `POST` to your URL when a run finishes.

```json
{ "webhookId": "wh_abc123", "createdAt": "…", "data": { "routine_run_id": "run_abc123" } }
```

Test events send `data: {}` — handle that without erroring.

Verification: HMAC-SHA256 of the **exact raw request body** using the signing secret, compared against the `X-Clay-Signature` header, formatted `sha256=<hex>`. Use a timing-safe comparison.

`routine_run_id` does not tell you whether the run was inline or batch. **Persist the run mode when you start the run** and look it up on delivery to pick the right results endpoint.

**Delivery is not guaranteed.** Webhooks are a latency optimization. Polling remains the source of truth.

### 2.6 Rate limits

Per-workspace. `429` responses carry `Retry-After` in seconds, and when available `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

Required handling: honor `Retry-After`; exponential backoff with jitter on concurrent requests; cap concurrency; prefer modest poll intervals over tight loops. Rate limits are the primary scaling risk in this app — see §4.

### 2.7 Errors

Non-2xx bodies are `{ "message": "…" }`. **No stable machine-readable error codes.** Branch on HTTP status only. Never regex the message string for control flow; it's fine to log it and to map it to user-facing copy.

`401`/`403` → auth. `404` → missing resource. `409`/`422` → validation/state. `429` → back off. `5xx` → retry with backoff.

### 2.8 Sanity check endpoint

```
GET /me  → authenticated Clay user + workspace
```
Use this in a startup health check and in the README's "verify your key" step.

---

## 3. Routine contract

This app is coupled to the Routine through an input and output schema. Document it in the repo as `docs/routine-contract.md` so a fork can adapt their own Routine.

### 3.1 Inputs the app sends

```json
{
  "id": "row-14",
  "inputs": {
    "first_name": "Ada",
    "last_name": "Lovelace",
    "email": "ada@example.com",
    "phone": "+1 555 0100",
    "company": "Example Co",
    "title": "VP Engineering",
    "linkedin_url": "https://linkedin.com/in/…",
    "campaign_id": "701XX0000000ABC",
    "campaign_name": "Booth — SaaStr 2026",
    "source_event": "SaaStr 2026",
    "uploaded_by": "chris.cardone@clay.com"
  }
}
```

`campaign_id` is passed per item — the Routine needs it to write the campaign member. `uploaded_by` gives auditability inside Clay.

### 3.2 Output the Routine must return

```json
{
  "status": "added",
  "first_name": "Ada",
  "last_name": "Lovelace",
  "email": "ada@example.com",
  "phone": "+15550100",
  "company": "Example Co",
  "title": "VP Engineering",
  "salesforce_contact_id": "003XX000004TmiQ",
  "salesforce_lead_id": null,
  "campaign_member_id": "00vXX0000001234",
  "failure_reason": null
}
```

`status` ∈ `added` | `already_member` | `enriched_only` | `skipped_duplicate` | `failed`.
`failure_reason` is a short machine-ish token the app maps to human copy: `invalid_email` | `no_match` | `salesforce_write_failed` | `missing_required_field` | `unknown`.

**Failure semantics:** a row can fail two ways. Clay marks the item `status: "failed"` with an `error.message` (the routine itself errored), *or* the item completes but the Routine's own payload reports `status: "failed"` with a `failure_reason` (business-logic failure). **Handle both.** Treating only the first as failure will overstate the success rate — this is the most likely correctness bug in the app.

### 3.3 Salesforce deep links

Built app-side, never returned by Clay:
```
{SALESFORCE_INSTANCE_URL}/lightning/r/Contact/{salesforce_contact_id}/view
{SALESFORCE_INSTANCE_URL}/lightning/r/CampaignMember/{campaign_member_id}/view
```

---

## 4. Run orchestration — the core design decision

### 4.1 Mode selection by row count

| Rows | Mode | Why |
| --- | --- | --- |
| 1–100 | Single inline run | One call, results on completion |
| 101–5,000 | **Chunked inline runs** — `ceil(n/100)` runs | Results land per completed chunk, giving genuine incremental feedback |
| 5,001–50,000 | Batch run via JSONL upload | Avoids hundreds of runs and their poll load; coarser progress |
| >50,000 | Reject at upload with guidance to split | Documented function batch ceiling |

Thresholds must be env-configurable (`CHUNK_SIZE`, `MAX_INLINE_TOTAL_ROWS`, `MAX_BATCH_ROWS`).

**Rationale for chunked inline as the default path:** the results endpoint gives no row data until a run is terminal. A single 400-row batch run would show a bar creeping for minutes and then dump 400 rows at once. Four chunked inline runs of 100 return usable rows roughly every quarter of the elapsed time, and the chunk states themselves are honest UI. This is the whole reason the monitor screen works.

**This trades against Clay's own written guidance.** `public-api/rate-limits.md` says "prefer batch and async endpoints over tight polling loops," and `batch-runs.md` positions batch as the path for many records. Chunked inline is a deliberate choice to buy incremental UI feedback at the cost of request volume. It is the right call for a human watching a screen for five minutes, and the wrong call for a headless nightly job. If rate limits prove tighter than expected in practice, **lowering `MAX_INLINE_TOTAL_ROWS` toward 0 degrades the app gracefully into pure batch mode** — build it so that's a config change, not a rewrite.

**Cost of that choice:** substantially more API calls, so rate limits bite sooner. Budget honestly: a 5,000-row file is 50 chunk runs, each needing repeated in-progress polls *plus* one-to-many paginated result fetches on completion. Mitigations are mandatory, not optional:
- Cap concurrent in-flight chunk runs (`MAX_CONCURRENT_CHUNKS`, default 5).
- One poll cycle per run polls all active chunks **sequentially**, not in parallel.
- **Always fetch results with `limit=100`** (§2.2). At the default 20 you pay 5× the reads.
- Global honoring of `Retry-After`: a 429 on any chunk pauses the whole run's polling.
- Persist rate-limit state on the run so the UI can display "rate limited, backing off."
- Fetch a chunk's results exactly once, on its transition to terminal — never re-fetch results for an already-persisted chunk.

### 4.2 State machine

```
created → validating → uploading → running → finalizing → complete
                                          ↘ completed_with_failures
                    ↘ validation_failed
                    ↘ failed
       running → stalled → (retry) → running
```

`stalled` = aggregate `finished` unchanged for `STALL_THRESHOLD_MINUTES` (default 10) while chunks remain non-terminal. Detected by the reconciliation cron, not the client.

### 4.3 Polling

- Client polls `GET /api/runs/{id}` — **never Clay directly.**
- Client interval: 2s while running, 10s when rate-limited or stalled, stop on terminal.
- Server-side, the app polls Clay at most once per run per `POLL_INTERVAL_MS` (default 3000), regardless of how many browser tabs are open. Guard with a `last_polled_at` timestamp on the run row so concurrent requests coalesce.
- Webhooks short-circuit the wait: on delivery, mark the chunk dirty and poll immediately.
- **Never leave polling active on a terminal run.**

### 4.4 Reconciliation cron

Vercel Cron, every 5 minutes, hitting an internal route protected by `CRON_SECRET`:

- Poll any run in a non-terminal state that hasn't been polled recently. This is what makes the app correct when a user closes their tab mid-run — without it, runs silently never finish.
- Mark runs `stalled` past the threshold.
- Expire runs past `MAX_RUN_AGE_HOURS` (default 24) as `failed` with a timeout reason.

---

## 5. Architecture on Vercel

### 5.1 Stack

- **Next.js (App Router) + TypeScript.** React Server Components for reads, route handlers for mutations.
- **Tailwind CSS**, fully token-driven theme so a fork reskins by editing one config.
- **Auth.js (NextAuth v5)** — Google provider.
- **Vercel Postgres** (or Neon) via Drizzle or Prisma. Relational, because runs → chunks → results is relational and the results table needs filtering and sorting.
- **Vercel Blob** for the original uploaded CSV and generated exports.
- **Vercel Cron** for reconciliation.
- **Zod** for every API boundary — inbound request bodies *and* Clay response parsing. Clay's responses are typed in the OpenAPI spec but you're crossing a network; validate.

### 5.2 Vercel-specific constraints

These are the ones that will actually bite:

1. **Function execution limits.** Serverless functions are not long-lived. No orchestration loop may run for the duration of a Clay run. Every unit of work must be short: start chunks, poll once, persist, return. Set `maxDuration` explicitly on the routes that need it (upload processing, batch result-file fetch) and keep them well inside the plan's ceiling. Confirm the current ceiling for the project's Vercel plan and Fluid Compute setting before choosing values — do not hardcode an assumption.

2. **No in-memory state between invocations.** No module-level caches, no in-process queues, no `setInterval`. Postgres is the only source of truth. This is the rule that most often gets violated by accident.

3. **Cold starts on the poll path.** Keep the poll route's import graph minimal — no heavy CSV or spreadsheet libraries imported into it.

4. **Webhook route must bypass auth middleware.** Add `/api/webhooks/clay` to the middleware's public matcher, and require signature verification there instead. This is the one route where a middleware misconfiguration is a security hole rather than an inconvenience.

5. **Raw body for signature verification.** Next.js route handlers must read `await req.text()` before any JSON parsing. Verify against that exact string. Parsing and re-stringifying will break the HMAC.

6. **Upload size limits.** Request body limits make large CSV posts through a route handler fragile. Upload the CSV **client-side directly to Vercel Blob** via a signed token, then hand the server the blob URL. Do not stream 30 MB through a serverless function.

7. **Cron routes need their own auth** (`CRON_SECRET` bearer check) since they don't carry a user session.

8. **`NEXTAUTH_URL` / `AUTH_URL` on preview deployments.** Preview URLs are dynamic; Google OAuth redirect URIs are static. Either register a stable preview domain or document that auth only works on production and localhost. Say which in the README — a fork will hit this in the first ten minutes.

### 5.3 Route map

```
Pages
  /                       redirect → /runs
  /signin                 Google sign-in
  /signin/denied          domain-rejected state
  /runs                   history
  /runs/new               composer
  /runs/[id]              monitor / terminal view

API (session-required)
  POST   /api/runs                    create run: validate, chunk, start
  GET    /api/runs                    list runs for user
  GET    /api/runs/[id]               run state + stats (the poll target)
  GET    /api/runs/[id]/results       paginated result rows, filterable by status
  GET    /api/runs/[id]/export        CSV stream — ?filter=all|failed
  POST   /api/runs/[id]/retry         new run seeded from failed rows
  POST   /api/upload/token            signed Vercel Blob client-upload token
  GET    /api/campaigns/search        campaign name lookup (or stub — see §7)

API (public, signature-verified)
  POST   /api/webhooks/clay           Clay run-finished delivery

API (cron-secret)
  GET    /api/cron/reconcile          poll non-terminal runs, flag stalls, expire
```

### 5.4 Data model

```
users                 -- managed by Auth.js
  id, email, name, image

runs
  id                  uuid pk
  user_id             fk → users
  filename            text
  source_blob_url     text
  campaign_id         text
  campaign_name       text
  mode                enum inline | batch
  status              enum (see §4.2)
  chunk_size          int
  total_rows          int
  skipped_rows        int          -- dropped pre-flight
  finished_rows       int          -- denormalized, sum over chunks
  succeeded_rows      int
  failed_rows         int
  column_mapping      jsonb
  clay_routine_id     text         -- captured at run time; env can change later
  error_message       text
  validation_errors   jsonb        -- batch validation_failed details
  rate_limited_until  timestamptz
  last_polled_at      timestamptz
  started_at          timestamptz
  finished_at         timestamptz
  created_at          timestamptz

run_chunks
  id                  uuid pk
  run_id              fk → runs
  chunk_index         int
  routine_run_id      text         -- Clay's id, null until started
  run_mode            enum inline | batch   -- webhook needs this
  status              enum pending | running | complete | failed
  total               int
  finished            int
  attempt_count       int
  error_message       text
  started_at, finished_at timestamptz
  unique (run_id, chunk_index)

run_results
  id                  uuid pk
  run_id              fk → runs
  chunk_id            fk → run_chunks
  item_id             text         -- the correlation id sent to Clay
  row_number          int          -- original CSV line, for user reference
  status              enum added | already_member | enriched_only | skipped_duplicate | failed
  first_name, last_name, email, phone, company, title  text
  salesforce_contact_id, salesforce_lead_id, campaign_member_id  text
  failure_reason      text
  raw_result          jsonb        -- full Clay payload, for debugging
  unique (run_id, item_id)

Indexes: runs(user_id, created_at desc); runs(status) where non-terminal;
         run_chunks(run_id); run_results(run_id, status); run_results(run_id, row_number)
```

`unique (run_id, item_id)` is what makes webhook + poll idempotent. Upsert on it.

---

## 6. Auth and access control

- Google OAuth via Auth.js. Google provider only — no credentials provider, no magic links.
- **Domain allowlist from env:** `ALLOWED_EMAIL_DOMAINS`, comma-separated (e.g. `clay.com,clay.dev`).
- Enforce in **three** places:
  1. `signIn` callback — reject non-matching domains, redirect to `/signin/denied`.
  2. Middleware — protect all pages and all `/api/*` except the webhook and cron routes.
  3. Every session-required route handler re-derives the user from the session and scopes queries by `user_id`. Never trust a `userId` from a request body or query param.
- **Fail closed:** if `ALLOWED_EMAIL_DOMAINS` is unset or empty, deny all sign-ins and surface a setup error. Do not default to open.
- Match on the domain **exactly** after the final `@`, lowercased. Do not use `endsWith` — `evilclay.com` ends with `clay.com`.
- Prefer Google's verified email claim over the raw profile email where available.
- Runs are scoped per user. No cross-user visibility in v1. If shared visibility is wanted later, make it an explicit env flag, not a default.

---

## 7. Salesforce campaign lookup — decide this explicitly

Two options; the repo should implement (a) and leave (b) behind an interface.

**(a) v1 — ID-only, no Salesforce credentials.** Validate the format (15 or 18 char Salesforce ID, `701` prefix for Campaign) and accept it. The Routine's write is the real validation; a bad ID surfaces as a run failure. **The UI must say this in plain language** so the user isn't surprised. Zero extra credentials, zero extra OAuth setup for a fork.

**(b) Later — read-only Salesforce integration.** Connected App with OAuth client credentials, a `SOQL SELECT` against `Campaign` for name search and metadata (type, status, start date, member count). Better UX, meaningfully more setup burden for a fork.

Put both behind `lib/salesforce/campaign-provider.ts` with a `CampaignProvider` interface and ship the ID-only implementation as the default. Select via `SALESFORCE_CAMPAIGN_PROVIDER=id-only|soql`.

---

## 8. CSV handling

- **Parse:** PapaParse, client-side for preview and validation, server-side for the authoritative pass (never trust client-parsed data).
- **Encoding:** handle UTF-8 with BOM — badge-scan exports from event platforms are frequently Windows-origin. Strip BOM before header matching or the first column mapping silently fails.
- **Delimiter:** auto-detect comma / semicolon / tab.
- **Header matching:** normalize (lowercase, strip non-alphanumeric) then match against a synonym table per field. `Email`, `Email Address`, `E-mail`, `Work Email` all → `email`. Keep the synonym table in a data file a fork can extend.
- **Validation tiers:**
  - *Blocking:* no rows, no email column mapped, >`MAX_BATCH_ROWS` rows.
  - *Warning, user chooses:* rows missing email, malformed email (RFC-pragmatic regex, not a strict parser), intra-file duplicates by normalized email.
- **Row numbers:** preserve the original CSV line number on every result row. When a marketer asks "which one failed?", the answer must be a line they can find in their spreadsheet.
- **Export:** stream the CSV response rather than buffering it — a 50,000-row export must not build a string in memory.

---

## 9. Environment variables

`.env.example` must document every one with a comment and where to get it.

```bash
# --- Google OAuth (console.cloud.google.com → Credentials → OAuth client ID) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# --- Auth.js ---
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_URL=                         # https://your-app.vercel.app  (http://localhost:3000 locally)

# --- Access control ---
ALLOWED_EMAIL_DOMAINS=clay.com    # comma-separated. UNSET = deny everyone.

# --- Clay (app.clay.com → Settings → Account → "API keys (beta)") ---
CLAY_API_KEY=
CLAY_API_BASE_URL=https://api.clay.com/public/v0
CLAY_ROUTINE_ID=                  # function:t_... from app.clay.com/functions → Details

# --- Clay webhooks (one-time: clay webhooks create <url>) ---
CLAY_WEBHOOK_ID=                  # wh_...   optional; polling works without it
CLAY_WEBHOOK_SIGNING_SECRET=      # whsec_... returned ONCE at creation

# --- Salesforce ---
SALESFORCE_INSTANCE_URL=          # https://yourorg.lightning.force.com
SALESFORCE_CAMPAIGN_PROVIDER=id-only

# --- Storage ---
POSTGRES_URL=
BLOB_READ_WRITE_TOKEN=

# --- Cron ---
CRON_SECRET=                      # openssl rand -hex 32

# --- Tuning ---
CHUNK_SIZE=100                    # Clay hard max for inline runs is 100
MAX_INLINE_TOTAL_ROWS=5000
MAX_BATCH_ROWS=50000              # Clay documented function batch ceiling
MAX_CONCURRENT_CHUNKS=5           # conservative guess — tune against observed 429s
RESULTS_PAGE_LIMIT=100            # Clay's max. Default of 20 costs 5x the reads.
POLL_INTERVAL_MS=3000
STALL_THRESHOLD_MINUTES=10
MAX_RUN_AGE_HOURS=24
```

---

## 10. Observability

- Structured JSON logs on every Clay call: routine id, run id, chunk index, HTTP status, duration, rate-limit headers. **Never log the API key or full row payloads containing PII.**
- Persist `raw_result` per row so a failure can be debugged without re-running.
- A `/api/health` route checking database reachability and `GET /me` against Clay. Useful for a fork verifying setup. Note `/me` returns only `user{id, name, cli_onboarded}` and `workspace{id}` — **no email, no workspace name.** It proves the key works; it can't be used to display workspace identity in the UI.
- Redact emails and phone numbers in error logs. This app handles PII by definition.

---

## 11. Testing

- **Unit:** CSV parsing (BOM, delimiters, quoted commas, missing headers), header synonym matching, chunking math at boundaries (100, 101, 5000, 5001), Salesforce ID validation, email normalization, domain allowlist including the `evilclay.com` case, webhook signature verification including a tampered-body rejection.
- **Integration with a mocked Clay API** (MSW or a fixture server) covering: inline happy path, inline with mixed per-item failures, `202` → `200` transition, batch `validation_failed` with >100 details, batch `processing_failed`, an unrecognized terminal status, `429` with `Retry-After`, and a `5xx` retry.
- **The two-kinds-of-failure test** is mandatory: an item Clay reports as `complete` whose Routine payload says `status: "failed"` must count as a failure in the run stats. Assert the success rate directly.
- **E2E (Playwright):** sign-in gate, denied-domain redirect, upload → mapping → campaign → run → terminal, export download, retry-failed.
- **Idempotency:** deliver the same webhook payload twice and assert no duplicate `run_results` rows.

---

## 12. Open questions to resolve before or during the build

1. **Does the Routine exist yet, and what is its actual input schema?** §3.1 is a proposed contract. If the Routine is already built, the real schema wins and the mapping defaults must be adjusted to it.
2. **Does the Routine do the Salesforce write, or only enrich?** If only enrich, the app needs Salesforce write credentials and §7 becomes mandatory, not optional — a substantially larger scope.
3. **Is `clay webhooks create` available to this workspace?** If not, ship polling-only and leave the webhook route dormant. The app must work correctly without webhooks.
4. **What Vercel plan?** Determines function `maxDuration` ceilings and whether Fluid Compute is available, which affects §5.2.1.
5. **Does the Clay workspace have a per-workspace rate limit headroom figure?** The docs don't publish numbers. `MAX_CONCURRENT_CHUNKS=5` is a conservative guess, not a measured value — tune it against real 429 behavior.
6. **Credit cost per row.** If the UI is to show estimated cost, that number has to come from the Routine's configuration; it isn't in the public API.
7. **How long does a `routine_run_id` stay fetchable?** No retention statement exists in the docs. §4.4's 24-hour expiry and any handling of a late webhook both assume runs remain readable for at least that long. Worth confirming with Clay — if retention is shorter, the expiry window has to shrink.
8. **Should >50,000 rows route to a Workflow instead of rejecting?** Workflows (Alpha) are Clay's documented escape hatch above that ceiling, buildable from the plugin or CLI rather than the Clay UI. Rejecting is fine for v1, but if large files are a real use case, a Workflow-backed path is the sanctioned answer rather than a workaround.

---

## 13. Confidence notes

Section 2 was verified field-by-field against `https://developers.clay.com/openapi.json` and nine doc pages on 2026-08-15.

**Documented and verified in the OpenAPI schema:** base URL; `clay-api-key` header name and location; all five endpoint paths and methods, including the asymmetric `run/{id}` vs `run-batch/{id}` results prefixes; every request and response field name and required/optional status; the 202-vs-200 semantics on both results endpoints; the 100-item inline cap and 64-char `id` limit; `limit` default 20 / max 100; the three batch terminal status string values; the 100-entry cap on validation error `details`; and — critically — that `RunResultsInProgress` is `additionalProperties: false` with no `data` field, so **row-level results genuinely cannot appear before terminal state.** That claim is the load-bearing one for the whole architecture and it holds.

**Documented in prose, verified:** webhook payload shape, `X-Clay-Signature`, the HMAC-SHA256-over-raw-body scheme, secret-returned-once, `data: {}` test events, delivery-not-guaranteed; `Retry-After` and `X-RateLimit-*`; the `{message}`-only error body with no stable codes; the explicit instruction not to assume the status set is closed; CLI-only webhook registration (no webhook path exists in the OpenAPI at all); and the absence of any Salesforce endpoint.

**Inference, not documented:** the 50,000-row batch ceiling — it appears only in Workflows-facing prose and is absent from the schema. Correct as a conservative default; wrong to treat as a constant.

**Design decisions, mine, open to change:** the chunked-inline strategy and its thresholds, the state machine, the data model, the Routine input/output contract in §3, the reconciliation cron, and every tuning default in §9.

**Unverifiable from the docs — confirm before relying on:**
- The batch `result_url` file format. Documented only as `format: uri`. JSONL is the reasonable inference given JSONL input, but **detect and handle both JSONL and a JSON array.**
- `result_url` and presigned-PUT-URL expiry windows.
- Whether sending `clay-api-key` on the presigned PUT actually breaks it (the doc's example omits it but never says it's forbidden).
- Any max JSONL file size or byte limit on upload.
- Actual rate-limit numbers and whether a concurrency cap exists. No figures are published, so `MAX_CONCURRENT_CHUNKS=5` is a guess to be tuned against observed 429s.
- `routine_run_id` retention — see §12.7.
- Whether per-item `error.message` values are stable enough to bucket failures by cause. **Assume not** — bucket on the Routine's own `failure_reason` field instead.
- Current Vercel function duration ceilings for this project's plan and Fluid Compute setting.

**One adjacent note:** `402` is a documented status on Clay's *Search* endpoints (quota/period limits). It does not appear on routines, so §2.7's map is complete today — but if `/api/campaigns/search` is ever backed by a Clay search rather than Salesforce, it needs a `402` branch.
