-- READY FOR MIGRATION REVIEW — P5 org-scoped Classroom credentials
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Goal: allow one Google Classroom teacher account per (user_id, org_id)
-- while keeping profiles.google_* as legacy fallback during transition.
--
-- Rollback conceptual:
--   1) Stop writing to organization_classroom_credentials in app code.
--   2) Continue reading profiles.google_* (unchanged).
--   3) DROP TABLE organization_classroom_credentials (after confirming unused).
-- Data in profiles is never deleted by this migration.

create table if not exists public.organization_classroom_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  mode text not null check (mode in ('teacher', 'student')),
  google_refresh_token text,
  google_token_expires_at timestamptz,
  classroom_linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, mode)
);

create index if not exists organization_classroom_credentials_user_idx
  on public.organization_classroom_credentials (user_id);

create index if not exists organization_classroom_credentials_org_idx
  on public.organization_classroom_credentials (org_id);

alter table public.organization_classroom_credentials enable row level security;

-- Own-row policies (idempotent create)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_classroom_credentials'
      and policyname = 'organization_classroom_credentials_select_own'
  ) then
    create policy organization_classroom_credentials_select_own
      on public.organization_classroom_credentials
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_classroom_credentials'
      and policyname = 'organization_classroom_credentials_insert_own'
  ) then
    create policy organization_classroom_credentials_insert_own
      on public.organization_classroom_credentials
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_classroom_credentials'
      and policyname = 'organization_classroom_credentials_update_own'
  ) then
    create policy organization_classroom_credentials_update_own
      on public.organization_classroom_credentials
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_classroom_credentials'
      and policyname = 'organization_classroom_credentials_delete_own'
  ) then
    create policy organization_classroom_credentials_delete_own
      on public.organization_classroom_credentials
      for delete
      using (auth.uid() = user_id);
  end if;
end $$;

comment on table public.organization_classroom_credentials is
  'P5: Classroom OAuth credentials scoped by PyBot user + organization. profiles.google_* remains legacy fallback until cutover.';
