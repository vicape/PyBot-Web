-- Migración 023 — Super admin: CRUD global en tablas de negocio
-- IDEMPOTENTE.

-- Perfiles: editar cualquier usuario (no crear/borrar — vienen de auth)
drop policy if exists profiles_super_admin_update on public.profiles;
create policy profiles_super_admin_update on public.profiles
  for update using (public.is_super_admin())
  with check (public.is_super_admin());

-- Colegios, membresías, cursos, actividades, inscripciones
drop policy if exists org_super_admin_all on public.organizations;
create policy org_super_admin_all on public.organizations
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists om_super_admin_all on public.organization_members;
create policy om_super_admin_all on public.organization_members
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists courses_super_admin_all on public.courses;
create policy courses_super_admin_all on public.courses
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists activities_super_admin_all on public.activities;
create policy activities_super_admin_all on public.activities
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists cm_super_admin_all on public.course_members;
create policy cm_super_admin_all on public.course_members
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists ap_super_admin_all on public.activity_progress;
create policy ap_super_admin_all on public.activity_progress
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists oi_super_admin_all on public.organization_invites;
create policy oi_super_admin_all on public.organization_invites
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists crp_super_admin_all on public.course_roster_pending;
create policy crp_super_admin_all on public.course_roster_pending
  for all using (public.is_super_admin())
  with check (public.is_super_admin());
