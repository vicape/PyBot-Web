-- ──────────────────────────────────────────────────────────────────────────
-- Migración 022 — Super admin de plataforma (lectura global)
-- Rol separado de owner/teacher de colegio. Solo lectura vía RLS + UI /dashboard/admin.
-- IDEMPOTENTE.
-- ──────────────────────────────────────────────────────────────────────────

-- IP completa (por si no corriste la 021)
alter table public.usage_sessions
  add column if not exists ip text;

create index if not exists usage_sessions_ip_idx
  on public.usage_sessions (ip);

-- Flag en perfil
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

create index if not exists profiles_is_super_admin_idx
  on public.profiles (is_super_admin)
  where is_super_admin = true;

-- Helper: ¿el usuario actual es super admin?
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_super_admin() to authenticated;

-- Telemetría: permitir lectura a super admins (escritura sigue solo service_role)
grant select on public.usage_sessions to authenticated;
grant select on public.usage_events to authenticated;

drop policy if exists usage_sessions_super_admin_select on public.usage_sessions;
create policy usage_sessions_super_admin_select on public.usage_sessions
  for select using (public.is_super_admin());

drop policy if exists usage_events_super_admin_select on public.usage_events;
create policy usage_events_super_admin_select on public.usage_events
  for select using (public.is_super_admin());

-- Lectura global en tablas de negocio
drop policy if exists profiles_super_admin_select on public.profiles;
create policy profiles_super_admin_select on public.profiles
  for select using (public.is_super_admin());

drop policy if exists org_super_admin_select on public.organizations;
create policy org_super_admin_select on public.organizations
  for select using (public.is_super_admin());

drop policy if exists om_super_admin_select on public.organization_members;
create policy om_super_admin_select on public.organization_members
  for select using (public.is_super_admin());

drop policy if exists oi_super_admin_select on public.organization_invites;
create policy oi_super_admin_select on public.organization_invites
  for select using (public.is_super_admin());

drop policy if exists courses_super_admin_select on public.courses;
create policy courses_super_admin_select on public.courses
  for select using (public.is_super_admin());

drop policy if exists activities_super_admin_select on public.activities;
create policy activities_super_admin_select on public.activities
  for select using (public.is_super_admin());

drop policy if exists cm_super_admin_select on public.course_members;
create policy cm_super_admin_select on public.course_members
  for select using (public.is_super_admin());

drop policy if exists ap_super_admin_select on public.activity_progress;
create policy ap_super_admin_select on public.activity_progress
  for select using (public.is_super_admin());

drop policy if exists crp_super_admin_select on public.course_roster_pending;
create policy crp_super_admin_select on public.course_roster_pending
  for select using (public.is_super_admin());

-- Super admin inicial: cambiá el email si hace falta
update public.profiles
set is_super_admin = true
where lower(email) = lower('vic@spaceclub.com.ar');
