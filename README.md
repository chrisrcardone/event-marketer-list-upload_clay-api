# Event Lead Router

Badge scans in. Enriched, deduped leads in your Salesforce campaign — with a number you can
stand behind.

**This is a demo built to show what a Clay-powered workflow can do — not an official Clay
internal tool.** The app says so on its sign-in screen and wears a "Demo" pill on every
signed-in screen; both stay in place in any fork.

Upload a CSV of event leads. The app cleans it client-side-visibly and server-side-authoritatively
(malformed emails and in-file duplicates are resolved **before anything reaches Clay**), runs
every identifiable person through a [Clay](https://clay.com) routine that enriches them
(LinkedIn → email → mobile, in gap-filling order), ensures the Account and Contact exist in
Salesforce, and adds each person to your chosen Campaign with an optional member disposition
(Registered, Attended, …). You watch honest live progress — chunk by chunk, with throughput
and ETA that only render when they're truthful — then download a verified result set with
working Salesforce links, and retry failures in one click.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js App Router, TypeScript strict |
| Styling | Tailwind CSS 4 + Terra (Clay brand) tokens — one file to reskin: `app/globals.css` |
| Host | Vercel (CLI deploys; Vercel Cron reconciles runs every 5 min) |
| Database | Supabase Postgres — RLS on every table |
| File storage | Supabase Storage (signed direct uploads; nothing streams through a route handler) |
| Auth | Supabase Auth — Google provider only, domain-allowlisted in four layers |
| Enrichment + CRM writes | Clay Public API → a Clay workflow routine that owns all Salesforce writes |
| Validation | Zod at every boundary — inbound requests and Clay responses |

The app holds **no Salesforce credentials**: the Clay workflow's connection does the reads and
writes, and the app only builds deep links.

## Quickstart (clone → deployed)

1. `npm install`, then `cp .env.example .env.local` — every key is documented inline.

2. **Supabase** — create a project ([database.new](https://database.new)):

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push        # schema, RLS, the before-user-created auth hook
   ```

   Copy the project URL + `anon` + `service_role` keys into `.env.local`
   (new-style `sb_publishable_…`/`sb_secret_…` keys work too, if enabled on your project).

3. **Google OAuth client** — [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → OAuth client ID → Web application:
   - Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
   - Authorized JavaScript origins: your production URL and `http://localhost:3000`

4. **Wire Supabase auth** (Google provider, auth hook, redirect URLs, DB allowlist) in one
   idempotent command:

   ```bash
   SUPABASE_PROJECT_REF=<ref> SITE_URL=https://<your-app>.vercel.app \
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ALLOWED_EMAIL_DOMAINS=yourco.com \
   node scripts/configure-supabase-auth.mjs
   ```

5. **Clay** — sign in to the [Clay CLI](https://github.com/clay-run/agent-plugins), then:
   - Build (or import) the enrichment workflow satisfying
     [docs/routine-contract.md](docs/routine-contract.md), connect your Salesforce, publish it,
     and register it: `clay routines create workflow <wf_id> --name "Event Lead Router"`.
   - Optionally register the small campaign-search workflow the combobox uses (same doc), or
     set `SALESFORCE_CAMPAIGN_PROVIDER=id-only` to paste campaign ids instead.
   - Mint the app's key: `clay api-keys create --name event-lead-router` → `CLAY_API_KEY`.
   - Set `CLAY_ROUTINE_ID` (and `CLAY_CAMPAIGN_ROUTINE_ID`) — workflow routines look like
     `workflow:wf_…`.

6. **Webhooks (optional)** — polling is the source of truth; webhooks only cut latency:

   ```bash
   clay webhooks create https://<your-app>.vercel.app/api/webhooks/clay
   ```

   The `signingSecret` is shown **once** → `CLAY_WEBHOOK_SIGNING_SECRET` (+ `CLAY_WEBHOOK_ID`).
   The app runs correctly with neither set.

7. **Vercel** — `npx vercel link`, add every `.env.local` value with `vercel env add`
   (production + preview), then `npx vercel deploy --prod`. `vercel.json` ships the
   reconciliation cron (`*/5 * * * *`, authorized by `CRON_SECRET` — generate with
   `openssl rand -hex 32`).

8. Verify: `https://<your-app>/api/health` should report `{"healthy":true}`; sign in with an
   allowed-domain Google account and run a CSV.

**Preview deployments:** Google OAuth redirect URIs are static and Vercel preview URLs are
not — auth works on production and localhost only, unless you register a stable preview
domain in both Google and Supabase.

## Access control (the four layers)

`ALLOWED_EMAIL_DOMAINS` is enforced independently in four places — a bug in one layer leaves
three standing. Matching is always **exact** on the substring after the **final** `@`,
lowercased (`evilclay.com` never matches `clay.com`), and everything **fails closed**: an
empty allowlist means nobody signs in, and the UI says so.

1. **Postgres auth hook** (`before_user_created_hook`): disallowed domains are rejected
   before a user row is ever created.
2. **`proxy.ts`** on every request: guests → sign-in; sessions with a disallowed domain →
   the rejected screen (also catches domains removed from the allowlist later).
3. **`requireUser()` / `requireUserForApi()`** re-derive the user from the session cookie in
   every handler — never from a request body or query param.
4. **Row Level Security** on every table: rows are scoped to `auth.uid()` *and* the JWT
   email's domain must be in `public.allowed_email_domains`.

The `/api/webhooks/clay` and `/api/cron/*` routes bypass the session proxy by design and
carry their own credentials (HMAC signature over the raw body; `CRON_SECRET` bearer).

## How a run works

- Rows are validated by the **one-of-three identity rule**: a row is runnable with an email,
  OR a first + last name + company, OR a LinkedIn URL. Email is *not* required.
- ≤ 100 rows: one inline Clay run. 101–5,000: chunked inline runs of 100 — results land per
  completed chunk, which is what makes the monitor honest. Above 5,000: one batch run
  (coarser progress). Above 50,000: rejected with guidance to split.
- The browser polls this app (never Clay) every 2s; the server coalesces to at most one Clay
  poll per `POLL_INTERVAL_MS` across any number of tabs, honors `Retry-After` on 429s, and
  persists rate-limit state so the "Clay asked us to slow down" banner reflects reality.
- A failed row is a failed row **both** when Clay marks the item failed *and* when the item
  completes but the routine's payload reports a business failure — the success rate counts
  both kinds.
- Vercel Cron reconciles every 5 minutes: closing the tab mid-run never strands a run;
  stalls are flagged; runs older than `MAX_RUN_AGE_HOURS` expire.
- There is deliberately **no cancel button**: Clay's API has no cancel, and pretending
  otherwise would lie about what "abandon" does.

## Design

The visual contract is the approved prototype in `design/prototype/`; its distilled spec —
every color, size, state, and copy string — is [docs/design-contract.md](docs/design-contract.md).
Terra tokens live in `app/globals.css`; a fork reskins by editing that one file. The
`/dev/components` gallery (dev-only; 404s in production) renders every primitive in every
state.

## Fonts

Clay's brand typeface **Roobert** (Displaay Type Foundry) is commercially licensed and not
committed to this public repo. Drop the three variable TTFs into `public/fonts/roobert/`
(git-ignored) if you're licensed; the UI otherwise falls back to the committed **Inter
Tight** (SIL OFL) with layouts intact.

## Tests

```bash
npm test        # unit: CSV parsing/BOM/delimiters, identity rule, dedupe, chunk math,
                # allowlist (incl. evilclay.com), Clay client (mocked: 202→200, open
                # terminal statuses, 429 Retry-After, 5xx retry, both failure kinds),
                # webhook HMAC (tampered-body rejection), PII redaction
```

The end-to-end path (sign-in → upload → mapping → campaign → run → monitor → export → retry)
is exercised with Playwright against a real session in `.e2e` scripts; RLS cross-user
protection is enforced by the policies in `supabase/migrations` (select-only, owner-scoped —
there are no insert/update policies for browser clients at all).

## Troubleshooting

- **`/api/health` says supabase error** — wrong service key. Legacy `service_role` keys and
  new `sb_secret_…` keys are both accepted; new-style keys must be enabled on the project.
- **Sign-in bounces to "That account won't work here"** — the domain isn't in
  `ALLOWED_EMAIL_DOMAINS` *and* the DB allowlist (`scripts/configure-supabase-auth.mjs`
  syncs both).
- **Campaign search returns nothing** — `CLAY_CAMPAIGN_ROUTINE_ID` unset (falls back to
  id-only paste) or the routine's Salesforce connection lacks read access.
- **Rows fail with `campaign_not_found`** — the campaign id/name doesn't exist in the org
  the *routine's* Salesforce connection points at.
- **Creating campaigns fails with `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY`** — the Salesforce
  connection's user needs the **Marketing User** checkbox (Setup → Users).

## License notes

- Application code: MIT.
- Inter Tight: SIL Open Font License (`public/fonts/InterTight-OFL.txt`).
- Roobert is not distributed here; bring your own license.
- Clay logo and claymation icons are Clay's brand assets, used here to demo a Clay-powered
  workflow. A non-Clay fork should swap `public/brand/` for its own marks.
