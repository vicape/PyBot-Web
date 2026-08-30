-- ──────────────────────────────────────────────────────────────────────────
-- Migración 019 — Alumnos solo ven cursos donde están en course_members.
--
-- Si en producción quedó activa la política de 012 (cualquier miembro del
-- colegio ve todos los cursos), este script la reemplaza por la de 013/014.
-- IDEMPOTENTE.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where org_id = p_org_id
      and user_id = auth.uid()
      and role in ('owner', 'teacher')
  );
$$;

grant execute on function public.is_org_staff(uuid) to authenticated;

drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    public.is_org_staff(org_id)
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = courses.id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists activities_select_member on public.activities;
create policy activities_select_member on public.activities
  for select using (
    exists (
      select 1
      from public.courses c
      where c.id = activities.course_id
        and public.is_org_staff(c.org_id)
    )
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = activities.course_id
        and cm.user_id = auth.uid()
    )
  );
