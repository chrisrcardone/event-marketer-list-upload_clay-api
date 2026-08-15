-- ═══════════════════════════════════════════════════════════════════════
-- Event Lead Router — initial schema
--
-- Design notes:
--   · The service_role key (server-side orchestration, webhook, cron) does
--     all writes. Browser clients hold the publishable/anon key and can
--     only ever SELECT their own rows — there are deliberately no insert/
--     update/delete policies for the authenticated role.
--   · RLS is the layer that holds when the app layers have a bug: every
--     policy scopes to auth.uid() AND requires the JWT email's domain to
--     be in public.allowed_email_domains (fail closed: empty table ⇒ no
--     access, matching the app's ALLOWED_EMAIL_DOMAINS fail-closed rule).
--   · public.allowed_email_domains is synced from the ALLOWED_EMAIL_DOMAINS
--     env var by scripts/configure-supabase-auth.mjs; it is readable only
--     by the auth hook and service role.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Allowlist table (layer 1 + layer 4 source of truth in the DB) ──────
create table public.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain <> ''),
  created_at timestamptz not null default now()
);

alter table public.allowed_email_domains enable row level security;
-- No policies on purpose: anon/authenticated get nothing. The auth hook
-- (supabase_auth_admin) and service_role read it via explicit grants.
grant select on table public.allowed_email_domains to supabase_auth_admin;

-- ── Domain check helper used inside every RLS policy ────────────────────
-- The substring after the FINAL @ (split_part with -1), lowercased, must
-- match an allowlisted domain exactly. "evilclay.com" never matches
-- "clay.com".
create or replace function public.current_email_domain_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_email_domains d
    where d.domain = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', -1))
  );
$$;

revoke execute on function public.current_email_domain_allowed() from public;
grant execute on function public.current_email_domain_allowed() to authenticated, anon, service_role;

-- ── Layer 1: reject disallowed domains at user creation ─────────────────
-- Registered as the Before-User-Created auth hook (configure via
-- scripts/configure-supabase-auth.mjs or Dashboard → Auth → Hooks).
-- Returning an error object with a 4xx http_code blocks the signup, so a
-- disallowed Google account never becomes a user row. The message carries
-- a machine-readable prefix + the attempted email so the OAuth callback
-- can show the designed rejected-domain screen.
create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
  user_domain text;
  email_verified text;
  domain_ok boolean;
begin
  user_email := lower(coalesce(event -> 'user' ->> 'email', ''));
  user_domain := lower(split_part(user_email, '@', -1));
  email_verified := coalesce(
    event -> 'user' -> 'user_metadata' ->> 'email_verified', 'true'
  );

  -- Prefer the provider's verified-email claim: an unverified address is
  -- rejected regardless of domain.
  if user_email = '' or email_verified = 'false' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'EMAIL_NOT_VERIFIED:' || user_email
      )
    );
  end if;

  select exists (
    select 1 from public.allowed_email_domains d where d.domain = user_domain
  ) into domain_ok;

  -- Fail closed: an empty allowlist rejects everyone.
  if not domain_ok then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'EMAIL_DOMAIN_NOT_ALLOWED:' || user_email
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created_hook(jsonb) from authenticated, anon, public;

-- ── Runs ────────────────────────────────────────────────────────────────
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- lifecycle: mirrors the designed status pills exactly, plus 'draft'
  -- (created, not yet started) and 'expired' (reconciliation gave up).
  status text not null default 'draft' check (status in (
    'draft', 'queued', 'uploading', 'validating', 'running', 'finalizing',
    'complete', 'completed_with_failures', 'validation_failed', 'failed',
    'expired'
  )),
  -- inline = chunked routine runs; batch = one run-batch upload
  mode text check (mode in ('inline', 'batch')),

  run_name text not null,
  file_name text not null,
  file_size_bytes bigint,
  source_storage_path text,          -- uploads bucket: {user_id}/{run_id}/source.csv

  -- campaign card snapshot (name, type, status, record id, members — per design)
  campaign_id text not null,
  campaign_name text not null,
  campaign_type text,
  campaign_status text,
  campaign_members_at_start integer,

  -- pre-flight accounting ("Running N of M rows · K dropped before upload")
  total_rows integer not null default 0,
  effective_rows integer not null default 0,
  dropped_unidentified integer not null default 0,
  dropped_malformed_email integer not null default 0,
  dropped_duplicates integer not null default 0,
  drop_choices jsonb not null default '{}'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,

  -- live counters (denormalized from run_rows as chunks land)
  finished_rows integer not null default 0,
  written_rows integer not null default 0,
  failed_rows integer not null default 0,
  skipped_rows integer not null default 0,

  -- batch mode
  clay_batch_run_id text,

  -- orchestration bookkeeping
  started_at timestamptz,
  finished_at timestamptz,
  last_polled_at timestamptz,        -- poll coalescing across open tabs
  last_progress_at timestamptz,      -- stall detection
  rate_limited_until timestamptz,    -- honors Retry-After; drives the rate-limited banner
  error jsonb,                       -- human-mapped cause when status = failed/validation_failed

  validation_errors_path text,       -- exports bucket: full validation-error CSV
  retry_of_run_id uuid references public.runs (id) on delete set null
);

create index runs_user_created_idx on public.runs (user_id, created_at desc);
create index runs_open_idx on public.runs (last_polled_at)
  where status in ('queued', 'uploading', 'validating', 'running', 'finalizing');

alter table public.runs enable row level security;

create policy "runs are visible to their owner"
  on public.runs for select to authenticated
  using (user_id = (select auth.uid()) and public.current_email_domain_allowed());
-- No insert/update/delete policies: all mutations go through server-side
-- route handlers using the service role, which re-derive the user from the
-- session (layer 3) before touching anything.

-- ── Chunks (one Clay routine run per 100-row slice, inline mode) ────────
create table public.run_chunks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index integer not null,          -- 0-based
  row_start integer not null,            -- offset into effective rows
  row_count integer not null check (row_count between 1 and 100),

  clay_run_id text,
  status text not null default 'queued' check (status in (
    'queued', 'starting', 'running', 'complete', 'failed'
  )),
  finished_items integer not null default 0,
  attempt integer not null default 1,
  error jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_polled_at timestamptz,

  unique (run_id, chunk_index)
);

create index run_chunks_run_idx on public.run_chunks (run_id, chunk_index);
create index run_chunks_open_idx on public.run_chunks (run_id)
  where status in ('queued', 'starting', 'running');

alter table public.run_chunks enable row level security;

create policy "chunks are visible to their run's owner"
  on public.run_chunks for select to authenticated
  using (user_id = (select auth.uid()) and public.current_email_domain_allowed());

-- ── Result rows ─────────────────────────────────────────────────────────
create table public.run_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- identity of the item within the run: webhook + poller both upsert on
  -- (run_id, item_id) so duplicate deliveries are idempotent.
  item_id text not null,
  original_row_number integer not null,  -- 1-based line in the uploaded CSV
  chunk_index integer,                   -- null in batch mode

  name text,
  email text,
  phone text,
  company text,
  title text,
  linkedin_url text,

  status text not null default 'pending' check (status in (
    'pending', 'written', 'failed', 'skipped'
  )),
  failure_reason text,                   -- human sentence ("Bad email", …)
  salesforce_url text,
  payload jsonb,                         -- raw routine output for the row

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (run_id, item_id)
);

create index run_rows_run_ordered_idx on public.run_rows (run_id, original_row_number);
create index run_rows_run_status_idx on public.run_rows (run_id, status);

alter table public.run_rows enable row level security;

create policy "result rows are visible to their run's owner"
  on public.run_rows for select to authenticated
  using (user_id = (select auth.uid()) and public.current_email_domain_allowed());

-- ── updated_at maintenance ──────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger runs_touch_updated_at
  before update on public.runs
  for each row execute function public.touch_updated_at();
create trigger run_chunks_touch_updated_at
  before update on public.run_chunks
  for each row execute function public.touch_updated_at();
create trigger run_rows_touch_updated_at
  before update on public.run_rows
  for each row execute function public.touch_updated_at();

-- ── Storage buckets ─────────────────────────────────────────────────────
-- Private. Uploads go straight from the browser to Storage via server-
-- issued signed upload URLs (never through a route handler); reads happen
-- server-side or via short-lived signed download URLs. No storage RLS
-- policies for authenticated: the signed URLs are the only doorway.
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false), ('exports', 'exports', false)
on conflict (id) do nothing;
