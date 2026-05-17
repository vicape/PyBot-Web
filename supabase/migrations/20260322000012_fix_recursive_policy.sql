-- ──────────────────────────────────────────────────────────────────────────
-- Migración 012 — Arreglo URGENTE de recursión infinita en organization_members.
--
-- La política om_select_my_orgs (definida en migración 001 y conservada/recreada
-- en 011) tenía una subquery a la PROPIA tabla organization_members, lo que
-- causa "infinite recursion detected in policy for relation organization_members".
--
-- Solución:
--   1) Política SELECT simple: cada user ve SOLO sus propias filas.
--   2) Para listar miembros de un colegio entero (caso docente viendo alumnos),
--      usar función security definer list_org_members(org_id) que verifica
--      que el caller pertenece a ese colegio.
-- IDEMPOTENTE.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Política SELECT en organization_members SIN recursión ─────────────────
drop policy if exists om_select_my_orgs on public.organization_members;

create policy om_select_self on public.organization_members
  for select using (user_id = auth.uid());

-- 2) Función security definer para listar miembros de un colegio ───────────
-- El propio user puede pedir esto solo si es miembro del colegio.
create or replace function public.list_org_members(p_org_id uuid)
returns table (user_id uuid, role text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_is_member boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = auth.uid()
  ) into v_is_member;

  if not v_is_member then
    return;
  end if;

  return query
    select om.user_id, om.role, om.created_at
    from public.organization_members om
    where om.org_id = p_org_id
    order by om.created_at;
end;
$$;
grant execute on function public.list_org_members(uuid) to authenticated;

-- 3) Función security definer para leer el rol del caller en un colegio ────
-- (útil para evitar SELECT directos en frontend que dependen de RLS sutil)
create or replace function public.my_role_in_org(p_org_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.organization_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;
grant execute on function public.my_role_in_org(uuid) to authenticated;

-- 4) Política simplificada para profiles_see_co_members ────────────────────
-- La versión anterior tenía subquery a organization_members que ahora con la
-- política simple solo ve filas del propio user → necesita rehacerse con SD.
drop policy if exists profiles_see_co_members on public.profiles;

create or replace function public.user_shares_org_with(p_other_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b on a.org_id = b.org_id
    where a.user_id = auth.uid()
      and b.user_id = p_other_uid
  );
$$;
grant execute on function public.user_shares_org_with(uuid) to authenticated;

create policy profiles_see_co_members on public.profiles
  for select using (
    id = auth.uid()
    or public.user_shares_org_with(id)
  );

-- 5) También revisar policy de courses_select_member y activities_select_member
-- (estas hacen subquery a organization_members; con la política simple ahora
-- el `exists` solo ve filas del propio user, lo que sigue siendo correcto)
-- → no necesitan cambios, pero las recreamos por seguridad.
drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = courses.org_id and m.user_id = auth.uid()
    )
  );

drop policy if exists activities_select_member on public.activities;
create policy activities_select_member on public.activities
  for select using (
    exists (
      select 1
      from public.courses c
      join public.organization_members m on m.org_id = c.org_id
      where c.id = activities.course_id and m.user_id = auth.uid()
    )
  );

-- 6) organizations_select: el JOIN del frontend "organizations + organization_members!inner"
-- funciona porque solo se lee la membership propia. Re-asegurar:
drop policy if exists org_select_member on public.organizations;
create policy org_select_member on public.organizations
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );
