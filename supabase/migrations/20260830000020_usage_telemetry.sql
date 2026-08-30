-- ──────────────────────────────────────────────────────────────────────────
-- Migración 020 — Telemetría de uso: usage_sessions + usage_events
-- Escrituras solo via service role (backend). RLS sin políticas de escritura
-- para authenticated/anon.
-- IDEMPOTENTE.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  anonymous_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds bigint not null default 0,
  is_authenticated boolean not null default false,
  consent_state text not null default 'unknown'
    check (consent_state in ('unknown', 'accepted', 'declined')),
  ip_hash text,
  ip_prefix text,
  country text,
  region text,
  city text,
  user_agent text,
  browser text,
  browser_version text,
  os text,
  os_version text,
  device_type text,
  language text,
  timezone text,
  screen_width integer,
  screen_height integer,
  referrer text,
  landing_path text,
  created_at timestamptz not null default now()
);

create index if not exists usage_sessions_anonymous_id_idx
  on public.usage_sessions (anonymous_id);
create index if not exists usage_sessions_user_id_idx
  on public.usage_sessions (user_id);
create index if not exists usage_sessions_started_at_idx
  on public.usage_sessions (started_at);
create index if not exists usage_sessions_last_seen_at_idx
  on public.usage_sessions (last_seen_at);
create index if not exists usage_sessions_country_idx
  on public.usage_sessions (country);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.usage_sessions (id) on delete cascade,
  anonymous_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  event_name text not null,
  event_category text,
  path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_session_id_idx
  on public.usage_events (session_id);
create index if not exists usage_events_anonymous_id_idx
  on public.usage_events (anonymous_id);
create index if not exists usage_events_user_id_idx
  on public.usage_events (user_id);
create index if not exists usage_events_event_name_idx
  on public.usage_events (event_name);
create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at);

alter table public.usage_sessions enable row level security;
alter table public.usage_events enable row level security;

-- Sin políticas INSERT/SELECT/UPDATE/DELETE para anon/authenticated:
-- solo service_role (backend) escribe y lee.
drop policy if exists usage_sessions_deny_all on public.usage_sessions;
drop policy if exists usage_events_deny_all on public.usage_events;

revoke all on public.usage_sessions from anon, authenticated;
revoke all on public.usage_events from anon, authenticated;
grant all on public.usage_sessions to service_role;
grant all on public.usage_events to service_role;
