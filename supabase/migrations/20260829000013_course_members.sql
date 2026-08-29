-- ──────────────────────────────────────────────────────────────────────────
-- Migración 013 — course_members: relación explícita usuario ↔ curso.
-- IDEMPOTENTE: se puede ejecutar varias veces sin romper datos existentes.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) Tabla course_members ───────────────────────────────────────────────────

create table if not exists public.course_members (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  source text not null check (source in ('manual', 'classroom', 'invite')),
  classroom_user_id text,
  classroom_email text,
  created_at timestamptz not null default now(),
  synced_at timestamptz,
  primary key (course_id, user_id)
);

create index if not exists course_members_course_id_idx on public.course_members (course_id);
create index if not exists course_members_user_id_idx on public.course_members (user_id);
create index if not exists course_members_classroom_user_id_idx
  on public.course_members (course_id, classroom_user_id)
  where classroom_user_id is not null;

-- 2) Helper: staff de la institución de un curso ─────────────────────────────

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
    join public.organization_members om on om.org_id = c.org_id
    where c.id = p_course_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'teacher')
  );
$$;

grant execute on function public.is_course_org_staff(uuid) to authenticated;

-- 3) RLS course_members ─────────────────────────────────────────────────────

alter table public.course_members enable row level security;

drop policy if exists cm_select_own on public.course_members;
create policy cm_select_own on public.course_members
  for select using (user_id = auth.uid());

drop policy if exists cm_select_staff on public.course_members;
create policy cm_select_staff on public.course_members
  for select using (
    exists (
      select 1
      from public.courses c
      join public.organization_members om on om.org_id = c.org_id
      where c.id = course_members.course_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'teacher')
    )
  );

drop policy if exists cm_insert_staff on public.course_members;
create policy cm_insert_staff on public.course_members
  for insert to authenticated
  with check (public.is_course_org_staff(course_id));

drop policy if exists cm_update_staff on public.course_members;
create policy cm_update_staff on public.course_members
  for update to authenticated
  using (public.is_course_org_staff(course_id))
  with check (public.is_course_org_staff(course_id));

drop policy if exists cm_delete_staff on public.course_members;
create policy cm_delete_staff on public.course_members
  for delete using (public.is_course_org_staff(course_id));

-- 4) Acceso a courses: staff ve todos; alumnos solo cursos inscriptos ────────

drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = courses.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = courses.id
        and cm.user_id = auth.uid()
    )
  );

-- 5) Acceso a activities ────────────────────────────────────────────────────

drop policy if exists activities_select_member on public.activities;
create policy activities_select_member on public.activities
  for select using (
    exists (
      select 1
      from public.courses c
      join public.organization_members m on m.org_id = c.org_id
      where c.id = activities.course_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = activities.course_id
        and cm.user_id = auth.uid()
    )
  );

-- 6) activity_progress: alumno solo si pertenece al curso ───────────────────

drop policy if exists ap_insert_enrolled on public.activity_progress;
create policy ap_insert_enrolled on public.activity_progress
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.activities act
      join public.course_members cm on cm.course_id = act.course_id
      where act.id = activity_progress.activity_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists ap_update_own on public.activity_progress;
create policy ap_update_own on public.activity_progress
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.activities act
      join public.course_members cm on cm.course_id = act.course_id
      where act.id = activity_progress.activity_id
        and cm.user_id = auth.uid()
    )
  );

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

-- 7) RPC list_course_members ────────────────────────────────────────────────

create or replace function public.list_course_members(p_course_id uuid)
returns table (
  user_id uuid,
  role text,
  source text,
  classroom_user_id text,
  classroom_email text,
  synced_at timestamptz,
  created_at timestamptz,
  display_name text,
  avatar_url text,
  email text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not public.is_course_org_staff(p_course_id) then
    return;
  end if;

  return query
  select
    cm.user_id,
    cm.role,
    cm.source,
    cm.classroom_user_id,
    cm.classroom_email,
    cm.synced_at,
    cm.created_at,
    p.display_name,
    p.avatar_url,
    p.email
  from public.course_members cm
  left join public.profiles p on p.id = cm.user_id
  where cm.course_id = p_course_id
  order by cm.created_at;
end;
$$;

grant execute on function public.list_course_members(uuid) to authenticated;

-- 8) RPC sync_classroom_course_roster (sincronización atómica) ────────────────

create or replace function public.sync_classroom_course_roster(
  p_course_id uuid,
  p_org_id uuid,
  p_enrolled jsonb,
  p_active_classroom_user_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_user_id uuid;
  v_classroom_user_id text;
  v_classroom_email text;
  v_synced int := 0;
  v_org_added int := 0;
  v_removed int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_org_staff(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  if not exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.org_id = p_org_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'curso_invalido');
  end if;

  if p_enrolled is not null and jsonb_typeof(p_enrolled) = 'array' then
    for v_item in select value from jsonb_array_elements(p_enrolled)
    loop
      v_user_id := (v_item->>'user_id')::uuid;
      v_classroom_user_id := nullif(trim(v_item->>'classroom_user_id'), '');
      v_classroom_email := nullif(trim(v_item->>'classroom_email'), '');

      if v_user_id is null then
        continue;
      end if;

      if not exists (
        select 1
        from public.organization_members om
        where om.org_id = p_org_id
          and om.user_id = v_user_id
      ) then
        insert into public.organization_members (org_id, user_id, role)
        values (p_org_id, v_user_id, 'student');
        v_org_added := v_org_added + 1;
      end if;

      insert into public.course_members (
        course_id,
        user_id,
        role,
        source,
        classroom_user_id,
        classroom_email,
        synced_at
      )
      values (
        p_course_id,
        v_user_id,
        'student',
        'classroom',
        v_classroom_user_id,
        v_classroom_email,
        now()
      )
      on conflict (course_id, user_id) do update
      set
        role = excluded.role,
        source = excluded.source,
        classroom_user_id = coalesce(excluded.classroom_user_id, course_members.classroom_user_id),
        classroom_email = coalesce(excluded.classroom_email, course_members.classroom_email),
        synced_at = excluded.synced_at;

      v_synced := v_synced + 1;
    end loop;
  end if;

  delete from public.course_members cm
  where cm.course_id = p_course_id
    and cm.source = 'classroom'
    and cm.classroom_user_id is not null
    and not (cm.classroom_user_id = any (coalesce(p_active_classroom_user_ids, array[]::text[])));

  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', v_org_added,
    'removed', v_removed
  );
end;
$$;

grant execute on function public.sync_classroom_course_roster(uuid, uuid, jsonb, text[]) to authenticated;

-- 9) RPC remove_course_member ───────────────────────────────────────────────

create or replace function public.remove_course_member(
  p_course_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_org_staff(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  delete from public.course_members
  where course_id = p_course_id
    and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.remove_course_member(uuid, uuid) to authenticated;
