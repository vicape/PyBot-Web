-- ──────────────────────────────────────────────────────────────────────────
-- Migración 011 — Estabilización post-auditoría.
-- IDEMPOTENTE: se puede ejecutar varias veces sin romper nada.
-- Esta migración consolida los arreglos para todos los problemas detectados:
--   • Política profiles_select_own con sintaxis correcta (la 010 usaba
--     "create policy if not exists" que NO existe en Postgres).
--   • Asegura columnas opcionales que el código usa con fallback.
--   • UNIQUE (org_id, classroom_course_id) para evitar cursos duplicados.
--   • Función RPC atómica create_organization_with_owner.
--   • Función find_profile_by_email (idempotente, por si la mig 008 falló).
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Columnas opcionales en profiles (defensivo: no rompen si ya existen) ──
alter table public.profiles add column if not exists classroom_linked_at timestamptz;
alter table public.profiles add column if not exists preferred_role text;
-- El CHECK se crea aparte solo si no existe ya
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_role_check
      check (preferred_role is null or preferred_role in ('teacher', 'student'));
  end if;
end$$;

alter table public.profiles add column if not exists google_refresh_token text;
alter table public.profiles add column if not exists google_token_expires_at timestamptz;

-- 2) Columnas opcionales en courses/activities ─────────────────────────────
alter table public.courses add column if not exists slug text;
alter table public.courses add column if not exists classroom_course_id text;
alter table public.activities add column if not exists description text default '';
alter table public.activities add column if not exists pybot_lesson_id text;

create index if not exists courses_org_slug_idx on public.courses (org_id, slug);
create index if not exists courses_classroom_id_idx on public.courses (classroom_course_id);

-- 3) UNIQUE para evitar duplicados al importar mismo curso de Classroom ────
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'courses_org_classroom_unique'
  ) then
    -- Solo único cuando classroom_course_id NO es null (parcial)
    create unique index courses_org_classroom_unique
      on public.courses (org_id, classroom_course_id)
      where classroom_course_id is not null;
  end if;
end$$;

-- 4) Políticas en profiles ─────────────────────────────────────────────────
-- Drop la política rota que la 010 intentó crear (puede o no existir)
drop policy if exists profiles_see_org_members on public.profiles;

-- Recrear profiles_select_own SIEMPRE (idempotente)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Permitir a docentes/owner ver perfiles de los miembros de SUS colegios.
-- Versión SIN recursión usando solo subqueries directas sobre organization_members.
drop policy if exists profiles_see_co_members on public.profiles;
create policy profiles_see_co_members on public.profiles
  for select using (
    id in (
      select om.user_id
      from public.organization_members om
      where om.org_id in (
        select om2.org_id
        from public.organization_members om2
        where om2.user_id = auth.uid()
      )
    )
  );

-- 5) Función find_profile_by_email (security definer) ──────────────────────
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select id, display_name, avatar_url
  from public.profiles
  where lower(trim(email)) = lower(trim(p_email))
  limit 1;
$$;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- 6) RPC atómico para crear colegio + membresía owner ──────────────────────
-- Evita la carrera donde se crea la org pero falla la membresía y queda huérfana.
create or replace function public.create_organization_with_owner(
  p_name text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_org_id uuid;
  v_attempt int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if v_slug = '' then
    v_slug := 'colegio-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  -- Reintento de slug si choca
  while v_attempt < 8 loop
    begin
      insert into public.organizations (name, slug, created_by)
      values (v_name, v_slug, v_uid)
      returning id into v_org_id;
      exit;  -- éxito
    exception when unique_violation then
      v_slug := v_slug || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      v_attempt := v_attempt + 1;
    end;
  end loop;

  if v_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'slug_taken');
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, v_uid, 'owner')
  on conflict (org_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'org_id', v_org_id, 'slug', v_slug);
end;
$$;
grant execute on function public.create_organization_with_owner(text, text) to authenticated;

-- 7) Activity progress: política para que docentes vean entregas de alumnos
-- (idempotente: drop si existía, recrear)
drop policy if exists ap_staff_view on public.activity_progress;
create policy ap_staff_view on public.activity_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.activities a
      join public.courses c on c.id = a.course_id
      join public.organization_members m on m.org_id = c.org_id
      where a.id = activity_progress.activity_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

-- 8) Re-asegurar políticas críticas (idempotentes) ─────────────────────────

-- organization_members: el propio user puede leer sus membresías
drop policy if exists om_select_my_orgs on public.organization_members;
create policy om_select_my_orgs on public.organization_members
  for select using (
    user_id = auth.uid()
    or org_id in (
      select om2.org_id
      from public.organization_members om2
      where om2.user_id = auth.uid()
    )
  );

-- courses: miembros pueden leer
drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = courses.org_id and m.user_id = auth.uid()
    )
  );

-- activities: miembros pueden leer
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
