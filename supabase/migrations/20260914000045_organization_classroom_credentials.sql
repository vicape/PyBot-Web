-- READY FOR MIGRATION REVIEW — P5 org-scoped Classroom credentials + P16 server-only refresh
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Design:
--   private.classroom_oauth_secrets  → refresh tokens (service role only; never granted to anon/authenticated)
--   public.organization_classroom_links → metadata only (linked_at, expires_at); browser may SELECT own rows
-- Unique key: (user_id, org_id, mode) for teacher|student multi-colegio.
-- profiles.google_* remains legacy dual-read fallback until cutover (server may still read; app stops writing RT there when vault works).
--
-- Rollback conceptual:
--   1) Stop writing private/public vault tables in API.
--   2) Continue legacy profiles path.
--   3) DROP TABLE private.classroom_oauth_secrets; DROP TABLE public.organization_classroom_links;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to postgres;
grant usage on schema private to service_role;

create table if not exists private.classroom_oauth_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  mode text not null check (mode in ('teacher', 'student')),
  google_refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, mode)
);

create index if not exists classroom_oauth_secrets_user_idx
  on private.classroom_oauth_secrets (user_id);

alter table private.classroom_oauth_secrets enable row level security;
-- No policies for authenticated/anon → only service_role / bypass.

revoke all on table private.classroom_oauth_secrets from public;
revoke all on table private.classroom_oauth_secrets from anon;
revoke all on table private.classroom_oauth_secrets from authenticated;
grant all on table private.classroom_oauth_secrets to postgres;
grant all on table private.classroom_oauth_secrets to service_role;

create table if not exists public.organization_classroom_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  mode text not null check (mode in ('teacher', 'student')),
  classroom_linked_at timestamptz,
  google_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, mode)
);

create index if not exists organization_classroom_links_user_idx
  on public.organization_classroom_links (user_id);

create index if not exists organization_classroom_links_org_idx
  on public.organization_classroom_links (org_id);

alter table public.organization_classroom_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_classroom_links'
      and policyname = 'organization_classroom_links_select_own'
  ) then
    create policy organization_classroom_links_select_own
      on public.organization_classroom_links
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

-- Browser must not INSERT/UPDATE/DELETE links (service role / API only).
revoke insert, update, delete on public.organization_classroom_links from anon, authenticated;
grant select on public.organization_classroom_links to authenticated;

comment on table private.classroom_oauth_secrets is
  'P5/P16: Classroom refresh tokens by (user_id, org_id, mode). Service role only. Never expose to browser RLS.';

comment on table public.organization_classroom_links is
  'P5/P16: Classroom link metadata by (user_id, org_id, mode). No refresh tokens. SELECT own only.';

-- Drop obsolete review table if someone applied the previous unsafe draft locally.
drop table if exists public.organization_classroom_credentials;

-- Service-role callable RPCs (PostgREST cannot expose private schema tables directly).
create or replace function public.upsert_classroom_oauth_secret(
  p_user_id uuid,
  p_org_id uuid,
  p_mode text,
  p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_mode not in ('teacher', 'student') then
    raise exception 'invalid_mode';
  end if;
  if p_refresh_token is null or length(trim(p_refresh_token)) = 0 then
    raise exception 'missing_refresh_token';
  end if;

  insert into private.classroom_oauth_secrets (user_id, org_id, mode, google_refresh_token, updated_at)
  values (p_user_id, p_org_id, p_mode, trim(p_refresh_token), now())
  on conflict (user_id, org_id, mode) do update
  set
    google_refresh_token = excluded.google_refresh_token,
    updated_at = now();
end;
$$;

create or replace function public.get_classroom_oauth_secret(
  p_user_id uuid,
  p_org_id uuid,
  p_mode text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rt text;
begin
  if p_mode not in ('teacher', 'student') then
    return null;
  end if;
  select s.google_refresh_token into v_rt
  from private.classroom_oauth_secrets s
  where s.user_id = p_user_id and s.org_id = p_org_id and s.mode = p_mode;
  return v_rt;
end;
$$;

create or replace function public.delete_classroom_oauth_secret(
  p_user_id uuid,
  p_org_id uuid,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from private.classroom_oauth_secrets s
  where s.user_id = p_user_id and s.org_id = p_org_id and s.mode = p_mode;
end;
$$;

-- RPCs are for service role / trusted API only — revoke from browser roles.
revoke all on function public.upsert_classroom_oauth_secret(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_classroom_oauth_secret(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_classroom_oauth_secret(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.upsert_classroom_oauth_secret(uuid, uuid, text, text) to service_role;
grant execute on function public.get_classroom_oauth_secret(uuid, uuid, text) to service_role;
grant execute on function public.delete_classroom_oauth_secret(uuid, uuid, text) to service_role;
