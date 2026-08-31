-- Migración 024 — Docentes pueden editar actividades de su colegio
-- IDEMPOTENTE.

drop policy if exists activities_update_staff on public.activities;
create policy activities_update_staff on public.activities
  for update to authenticated
  using (
    exists (
      select 1
      from public.courses c
      where c.id = activities.course_id
        and public.is_org_staff(c.org_id)
    )
  )
  with check (
    exists (
      select 1
      from public.courses c
      where c.id = activities.course_id
        and public.is_org_staff(c.org_id)
    )
  );
