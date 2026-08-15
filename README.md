# Event Lead Router

Badge scans in. Enriched, deduped leads in your Salesforce campaign — with a number you can
stand behind.

**This is a demo built to show what a Clay-powered workflow can do — not an official Clay
internal tool.** The app says so on its sign-in screen and wears a "Demo" pill on every
signed-in screen; both stay in place in any fork.

Upload a CSV of event leads. The app cleans it (dedupe + malformed emails resolved before
anything reaches Clay), runs every identifiable person through a [Clay](https://clay.com)
Routine that enriches them and writes them into a Salesforce campaign, and shows honest live
progress — chunk by chunk, with throughput and ETA that only render when they're truthful —
plus a downloadable, verified result set.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js App Router, TypeScript strict |
| Styling | Tailwind CSS 4 + Terra (Clay brand) tokens — one file to reskin: `app/globals.css` |
| Host | Vercel (auto-deploy from `main`; Vercel Cron for run reconciliation) |
| Database | Supabase Postgres (RLS on every table) |
| File storage | Supabase Storage (uploaded CSVs, generated exports) |
| Auth | Supabase Auth — Google provider only, domain-allowlisted |
| Enrichment | Clay Public API (`docs/technical-spec.md`) |
| Validation | Zod at every API boundary, inbound and Clay responses |

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Terra design system, component primitives, `/dev/components` gallery, app shell | ✅ |
| 2 | Supabase schema + RLS, Google OAuth, domain allowlist (4 layers), sign-in screens | ✅ |
| 3 | Clay API client (`lib/clay/`), typed + Zod-validated, mocked test suite | — |
| 4 | CSV pipeline, chunking, run orchestration, webhook + cron reconciliation | — |
| 5 | All screens, real polling monitor, streamed exports, retry-failed | — |
| 6 | Hardening: E2E, a11y, responsive, PII-redacted logging, docs | — |

## Quickstart

> The target: clone → deployed in under ten minutes. Steps 5–7 land with later phases.

1. `npm install`, then `cp .env.example .env.local` (each key is documented inline).
2. **Supabase** — create a project ([database.new](https://database.new)), then:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push        # applies supabase/migrations (schema, RLS, auth hook)
   ```

   Copy the project URL + publishable + secret keys into `.env.local`.
3. **Google OAuth client** — [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials)
   → Create OAuth client ID → Web application:
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Authorized JavaScript origins: your production URL and `http://localhost:3000`
4. **Wire it together** (Google provider, before-user-created hook, redirect URLs, and the
   Postgres copy of the domain allowlist) in one idempotent command:

   ```bash
   SUPABASE_PROJECT_REF=<ref> SITE_URL=https://<your-app>.vercel.app \
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ALLOWED_EMAIL_DOMAINS=yourco.com \
   node scripts/configure-supabase-auth.mjs
   ```

5. `npm run dev` → [http://localhost:3000](http://localhost:3000). Sign in with a Google
   account on an allowed domain. The component gallery is at `/dev/components`.

Auth works on production and localhost only: Google OAuth redirect URIs are static, and
Vercel preview URLs are not — don't expect sign-in to work on `*-git-*.vercel.app` previews
unless you register a stable preview domain.

### Access control (the four layers)

`ALLOWED_EMAIL_DOMAINS` is enforced independently in four places — a bug in one layer
leaves three standing. Matching is always **exact** on the substring after the **final** `@`,
lowercased (`evilclay.com` never matches `clay.com`), and everything **fails closed**:
empty allowlist ⇒ nobody signs in, and the UI says so.

1. **Postgres auth hook** (`before_user_created_hook`, registered by the setup script):
   disallowed domains are rejected before a user row is ever created.
2. **`proxy.ts`** on every request: guests → sign-in; sessions with a disallowed domain →
   the rejected screen (this also catches domains removed from the allowlist later).
3. **`requireUser()`** in every session-required route handler re-derives the user from the
   session cookie — never from a request body or query param.
4. **Row Level Security** on every table: rows are scoped to `auth.uid()` *and* the JWT
   email's domain must be in `public.allowed_email_domains`.

## Fonts

Clay's brand typeface **Roobert** (Displaay Type Foundry) is commercially licensed and is
**not** committed to this public repo. The UI is built for it and falls back to the committed
**Inter Tight** (SIL OFL, `public/fonts/`) when it's absent — layouts hold either way.

If you have a Roobert license (Clay folks do), drop the three variable TTFs into
`public/fonts/roobert/` (git-ignored):

```
public/fonts/roobert/RoobertVF.ttf
public/fonts/roobert/RoobertUprightsVF.ttf
public/fonts/roobert/RoobertSemiMonoVF.ttf
```

## Design

The visual contract is the approved prototype in `design/prototype/` (open
`Event Lead Router.dc.html` via a local static server). Its distilled, implementable spec —
every color, size, state, and copy string — lives in
[docs/design-contract.md](docs/design-contract.md). The built app is meant to be visually
indistinguishable from the prototype; presentation differences are bugs.

Terra tokens (colors, type, radii, shadows, motion) live in `app/globals.css` as CSS custom
properties mapped into Tailwind utilities. A fork reskins by editing that one file.

## Repo layout

```
app/               Next.js App Router routes
  (app)/           signed-in shell (top bar with the Demo pill)
  (app)/dev/components   component gallery — dev-only, 404s in production
components/ui/     primitives (Button, StatusPill, ChunkTrack, …)
components/shell/  top bar
lib/ui/            cn, formatters, count-up hook
design/prototype/  the approved design, verbatim (+ asset provenance notes)
docs/              design-contract.md, technical-spec.md (Phase 3+)
public/brand/      optimized logo + claymation icons
public/fonts/      Inter Tight (committed) · roobert/ (git-ignored, see Fonts)
```

## License notes

- Application code: MIT (LICENSE to be added).
- Inter Tight: SIL Open Font License (`public/fonts/InterTight-OFL.txt`).
- Roobert is not distributed here; bring your own license.
- Clay logo and claymation icons are Clay's brand assets, used here to demo a Clay-powered
  workflow. A fork that isn't Clay-affiliated should swap `public/brand/` for its own marks.
