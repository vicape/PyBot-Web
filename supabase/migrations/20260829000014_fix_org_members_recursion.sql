-- ──────────────────────────────────────────────────────────────────────────
-- Migración 014 — Hotfix recursión RLS en organization_members.
--
-- Si coexisten om_select_my_orgs (subquery recursiva) y om_select_self,
-- Postgres evalúa ambas y dispara "infinite recursion detected".
--
-- También reemplaza subqueries directas a organization_members en políticas
-- de otras tablas por helpers SECURITY DEFINER.
-- IDEMPOTENTE.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Política SELECT en organization_members: solo filas propias ─────────────

drop policy if exists om_select_my_orgs on public.organization_members;
drop policy if exists om_select_self on public.organization_members;

create policy om_select_self on public.organization_members
  for select using (user_id = auth.uid());

-- 2) Helper: ¿el caller es staff (owner/teacher) de una institución? ─────────

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

-- 3) Reemplazar is_course_org_staff para consistencia ─────────────────────────

create or replace function public.is_course_org_staff(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and public.is_org_staff(c.org_id)
  );
$$;

grant execute on function public.is_course_org_staff(uuid) to authenticated;

-- 4) course_members: staff via helper (sin subquery RLS a organization_members)

drop policy if exists cm_select_staff on public.course_members;
create policy cm_select_staff on public.course_members
  for select using (public.is_course_org_staff(course_id));

-- 5) courses ────────────────────────────────────────────────────────────────

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

-- 6) activities ─────────────────────────────────────────────────────────────

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

-- 7) activity_progress staff view ───────────────────────────────────────────

drop policy if exists ap_staff_view on public.activity_progress;
create policy ap_staff_view on public.activity_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.activities a
      join public.courses c on c.id = a.course_id
      where a.id = activity_progress.activity_id
        and public.is_org_staff(c.org_id)
    )
  );

-- 8) organizations: acceso via helper ───────────────────────────────────────

drop policy if exists org_select_member on public.organizations;
create policy org_select_member on public.organizations
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

-- Nota: la subquery anterior solo lee filas propias (om_select_self) → sin recursión.

-- 9) RPC list_my_org_memberships (fallback seguro para el dashboard) ──────────

create or replace function public.list_my_org_memberships()
returns table (org_id uuid, role text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select om.org_id, om.role, om.created_at
  from public.organization_members om
  where om.user_id = auth.uid()
  order by om.created_at;
$$;

grant execute on function public.list_my_org_memberships() to authenticated;
