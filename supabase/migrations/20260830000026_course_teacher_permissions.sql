-- Migración 026 — Co-docente de curso (course_members.teacher)
-- IDEMPOTENTE. Helper SECURITY DEFINER + políticas para administrar SU curso.

-- 1) Helper: ¿puede enseñar este curso? (staff org OR course teacher)
create or replace function public.is_course_teacher(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_course_org_staff(p_course_id)
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = p_course_id
        and cm.user_id = auth.uid()
        and cm.role = 'teacher'
    );
$$;

grant execute on function public.is_course_teacher(uuid) to authenticated;

-- 2) courses — co-docente puede SELECT/UPDATE su curso
drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    public.is_org_staff(org_id)
    or public.is_course_teacher(id)
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = courses.id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists courses_update_staff on public.courses;
create policy courses_update_staff on public.courses
  for update to authenticated
  using (public.is_course_teacher(id))
  with check (public.is_course_teacher(id));

-- 3) activities — co-docente insert/update en su curso
drop policy if exists activities_select_member on public.activities;
create policy activities_select_member on public.activities
  for select using (
    public.is_course_teacher(course_id)
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = activities.course_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists activities_insert_staff on public.activities;
create policy activities_insert_staff on public.activities
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_course_teacher(course_id)
  );

drop policy if exists activities_update_staff on public.activities;
create policy activities_update_staff on public.activities
  for update to authenticated
  using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

-- 4) course_members — co-docente gestiona roster de SU curso
drop policy if exists cm_select_staff on public.course_members;
create policy cm_select_staff on public.course_members
  for select using (public.is_course_teacher(course_id));

drop policy if exists cm_insert_staff on public.course_members;
create policy cm_insert_staff on public.course_members
  for insert to authenticated
  with check (public.is_course_teacher(course_id));

drop policy if exists cm_update_staff on public.course_members;
create policy cm_update_staff on public.course_members
  for update to authenticated
  using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

drop policy if exists cm_delete_staff on public.course_members;
create policy cm_delete_staff on public.course_members
  for delete to authenticated
  using (public.is_course_teacher(course_id));

-- 5) activity_progress — co-docente ve entregas/progreso del curso
drop policy if exists ap_staff_view on public.activity_progress;
create policy ap_staff_view on public.activity_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.activities a
      where a.id = activity_progress.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

-- 6) RPC update_activity_for_staff — también co-docente
create or replace function public.update_activity_for_staff(
  p_activity_id uuid,
  p_title text,
  p_description text,
  p_pybot_lesson_id text,
  p_starter_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  select a.course_id into v_course_id
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    raise exception 'activity_not_found';
  end if;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    raise exception 'forbidden';
  end if;

  update public.activities
  set
    title = trim(p_title),
    description = coalesce(p_description, ''),
    pybot_lesson_id = nullif(trim(p_pybot_lesson_id), ''),
    starter_code = coalesce(p_starter_code, '')
  where id = p_activity_id;
end;
$$;

grant execute on function public.update_activity_for_staff(uuid, text, text, text, text) to authenticated;

-- 7) get_activity_for_ide — staff org o course teacher o miembro
create or replace function public.get_activity_for_ide(p_activity_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  starter_code text,
  pybot_lesson_id text,
  course_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.title, a.description, a.starter_code, a.pybot_lesson_id, a.course_id
  from public.activities a
  where a.id = p_activity_id
    and (
      public.is_course_teacher(a.course_id)
      or coalesce(public.is_super_admin(), false)
      or exists (
        select 1
        from public.course_members cm
        where cm.course_id = a.course_id
          and cm.user_id = auth.uid()
      )
    );
$$;

grant execute on function public.get_activity_for_ide(uuid) to authenticated;

-- 8) course_roster_pending: role (student|teacher) para co-docentes pendientes
alter table public.course_roster_pending
  add column if not exists role text not null default 'student';

alter table public.course_roster_pending
  drop constraint if exists course_roster_pending_role_check;

alter table public.course_roster_pending
  add constraint course_roster_pending_role_check
  check (role in ('student', 'teacher'));

-- Policies pending: co-docente del curso también
drop policy if exists crp_select_staff on public.course_roster_pending;
create policy crp_select_staff on public.course_roster_pending
  for select using (public.is_course_teacher(course_id));

drop policy if exists crp_insert_staff on public.course_roster_pending;
create policy crp_insert_staff on public.course_roster_pending
  for insert to authenticated
  with check (public.is_course_teacher(course_id));

drop policy if exists crp_update_staff on public.course_roster_pending;
create policy crp_update_staff on public.course_roster_pending
  for update to authenticated
  using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

drop policy if exists crp_delete_staff on public.course_roster_pending;
create policy crp_delete_staff on public.course_roster_pending
  for delete using (public.is_course_teacher(course_id));

-- Listar pendientes con role
drop function if exists public.list_course_roster_pending(uuid);
create or replace function public.list_course_roster_pending(p_course_id uuid)
returns table (
  id uuid,
  classroom_user_id text,
  email text,
  display_name text,
  synced_at timestamptz,
  role text
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
  if not public.is_course_teacher(p_course_id) then
    return;
  end if;

  return query
  select p.id, p.classroom_user_id, p.email, p.display_name, p.synced_at, p.role
  from public.course_roster_pending p
  where p.course_id = p_course_id
  order by p.role desc, coalesce(p.display_name, p.email);
end;
$$;

grant execute on function public.list_course_roster_pending(uuid) to authenticated;

-- claim: respeta role pendiente (student|teacher)
create or replace function public.claim_pending_course_rosters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  r record;
  v_claimed int := 0;
  v_courses uuid[] := array[]::uuid[];
  v_role text;
  v_org_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select lower(trim(email)) into v_email
  from public.profiles
  where id = v_uid;

  if v_email is null or v_email = '' then
    select lower(trim(email)) into v_email from auth.users where id = v_uid;
  end if;

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', true, 'claimed', 0, 'course_ids', '[]'::jsonb);
  end if;

  for r in
    select p.*
    from public.course_roster_pending p
    where lower(trim(p.email)) = v_email
  loop
    v_role := case when r.role = 'teacher' then 'teacher' else 'student' end;
    -- Org membership: teacher pendiente → teacher org; student → student
    -- Solo inserta si no existe (no baja owner/teacher existente)
    v_org_role := case when v_role = 'teacher' then 'teacher' else 'student' end;

    if not exists (
      select 1 from public.organization_members om
      where om.org_id = r.org_id and om.user_id = v_uid
    ) then
      insert into public.organization_members (org_id, user_id, role)
      values (r.org_id, v_uid, v_org_role);
    end if;

    insert into public.course_members (
      course_id, user_id, role, source, classroom_user_id, classroom_email, synced_at
    )
    values (
      r.course_id, v_uid, v_role, 'classroom',
      r.classroom_user_id, r.email, now()
    )
    on conflict (course_id, user_id) do update
    set
      role = case
        when course_members.role = 'teacher' then 'teacher'
        else excluded.role
      end,
      source = excluded.source,
      classroom_user_id = coalesce(excluded.classroom_user_id, course_members.classroom_user_id),
      classroom_email = coalesce(excluded.classroom_email, course_members.classroom_email),
      synced_at = excluded.synced_at;

    delete from public.course_roster_pending where id = r.id;
    v_claimed := v_claimed + 1;
    v_courses := array_append(v_courses, r.course_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'claimed', v_claimed,
    'course_ids', to_jsonb(v_courses)
  );
end;
$$;

grant execute on function public.claim_pending_course_rosters() to authenticated;

-- sync roster: permitir co-docente
create or replace function public.sync_classroom_course_roster(
  p_course_id uuid,
  p_org_id uuid,
  p_enrolled jsonb,
  p_active_classroom_user_ids text[],
  p_pending jsonb default '[]'::jsonb
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
  v_pending_upserted int := 0;
  v_pending_removed int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_teacher(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.org_id = p_org_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'curso_invalido');
  end if;

  if p_enrolled is not null and jsonb_typeof(p_enrolled) = 'array' then
    for v_item in select value from jsonb_array_elements(p_enrolled)
    loop
      v_user_id := nullif(v_item->>'user_id', '')::uuid;
      v_classroom_user_id := nullif(v_item->>'classroom_user_id', '');
      v_classroom_email := nullif(v_item->>'classroom_email', '');
      if v_user_id is null then
        continue;
      end if;

      if not exists (
        select 1 from public.organization_members om
        where om.org_id = p_org_id and om.user_id = v_user_id
      ) then
        insert into public.organization_members (org_id, user_id, role)
        values (p_org_id, v_user_id, 'student');
        v_org_added := v_org_added + 1;
      end if;

      insert into public.course_members (
        course_id, user_id, role, source, classroom_user_id, classroom_email, synced_at
      )
      values (
        p_course_id, v_user_id, 'student', 'classroom',
        v_classroom_user_id, v_classroom_email, now()
      )
      on conflict (course_id, user_id) do update
      set
        source = case
          when course_members.source in ('invite', 'manual') then course_members.source
          else 'classroom'
        end,
        classroom_user_id = coalesce(excluded.classroom_user_id, course_members.classroom_user_id),
        classroom_email = coalesce(excluded.classroom_email, course_members.classroom_email),
        synced_at = excluded.synced_at,
        role = case
          when course_members.role = 'teacher' then 'teacher'
          else 'student'
        end;

      v_synced := v_synced + 1;
    end loop;
  end if;

  -- Quitar solo source=classroom que ya no están en Classroom (no invite/manual)
  if p_active_classroom_user_ids is not null then
    with doomed as (
      select cm.user_id
      from public.course_members cm
      where cm.course_id = p_course_id
        and cm.source = 'classroom'
        and cm.role = 'student'
        and (
          cm.classroom_user_id is null
          or not (cm.classroom_user_id = any (p_active_classroom_user_ids))
        )
    )
    delete from public.course_members cm
    using doomed d
    where cm.course_id = p_course_id
      and cm.user_id = d.user_id;

    get diagnostics v_removed = row_count;
  end if;

  -- Pending students (role default student)
  if p_pending is not null and jsonb_typeof(p_pending) = 'array' then
    for v_item in select value from jsonb_array_elements(p_pending)
    loop
      v_classroom_user_id := nullif(v_item->>'classroom_user_id', '');
      v_classroom_email := lower(trim(coalesce(v_item->>'email', '')));
      if v_classroom_user_id is null or v_classroom_email = '' then
        continue;
      end if;

      insert into public.course_roster_pending (
        course_id, org_id, classroom_user_id, email, display_name, role, synced_at
      )
      values (
        p_course_id,
        p_org_id,
        v_classroom_user_id,
        v_classroom_email,
        nullif(v_item->>'display_name', ''),
        'student',
        now()
      )
      on conflict (course_id, classroom_user_id) do update
      set
        email = excluded.email,
        display_name = coalesce(excluded.display_name, course_roster_pending.display_name),
        role = 'student',
        synced_at = excluded.synced_at;

      v_pending_upserted := v_pending_upserted + 1;
    end loop;
  end if;

  if p_active_classroom_user_ids is not null then
    delete from public.course_roster_pending p
    where p.course_id = p_course_id
      and p.role = 'student'
      and not (p.classroom_user_id = any (p_active_classroom_user_ids));
    get diagnostics v_pending_removed = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', v_org_added,
    'removed', v_removed,
    'pending_upserted', v_pending_upserted,
    'pending_removed', v_pending_removed
  );
end;
$$;

grant execute on function public.sync_classroom_course_roster(uuid, uuid, jsonb, text[], jsonb) to authenticated;

-- Sync co-docentes Classroom → course_members.teacher
create or replace function public.sync_classroom_course_teachers(
  p_course_id uuid,
  p_org_id uuid,
  p_enrolled jsonb,
  p_active_classroom_user_ids text[],
  p_pending jsonb default '[]'::jsonb
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
  v_pending_upserted int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_teacher(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.org_id = p_org_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'curso_invalido');
  end if;

  if p_enrolled is not null and jsonb_typeof(p_enrolled) = 'array' then
    for v_item in select value from jsonb_array_elements(p_enrolled)
    loop
      v_user_id := nullif(v_item->>'user_id', '')::uuid;
      v_classroom_user_id := nullif(v_item->>'classroom_user_id', '');
      v_classroom_email := nullif(v_item->>'classroom_email', '');
      if v_user_id is null then
        continue;
      end if;

      -- No duplicar al caller; ya es docente del curso vía org o membership
      if v_user_id = v_uid then
        continue;
      end if;

      if not exists (
        select 1 from public.organization_members om
        where om.org_id = p_org_id and om.user_id = v_user_id
      ) then
        insert into public.organization_members (org_id, user_id, role)
        values (p_org_id, v_user_id, 'teacher');
        v_org_added := v_org_added + 1;
      end if;

      insert into public.course_members (
        course_id, user_id, role, source, classroom_user_id, classroom_email, synced_at
      )
      values (
        p_course_id, v_user_id, 'teacher', 'classroom',
        v_classroom_user_id, v_classroom_email, now()
      )
      on conflict (course_id, user_id) do update
      set
        role = 'teacher',
        source = case
          when course_members.source in ('invite', 'manual') then course_members.source
          else 'classroom'
        end,
        classroom_user_id = coalesce(excluded.classroom_user_id, course_members.classroom_user_id),
        classroom_email = coalesce(excluded.classroom_email, course_members.classroom_email),
        synced_at = excluded.synced_at;

      v_synced := v_synced + 1;
    end loop;
  end if;

  if p_pending is not null and jsonb_typeof(p_pending) = 'array' then
    for v_item in select value from jsonb_array_elements(p_pending)
    loop
      v_classroom_user_id := nullif(v_item->>'classroom_user_id', '');
      v_classroom_email := lower(trim(coalesce(v_item->>'email', '')));
      if v_classroom_user_id is null or v_classroom_email = '' then
        continue;
      end if;

      insert into public.course_roster_pending (
        course_id, org_id, classroom_user_id, email, display_name, role, synced_at
      )
      values (
        p_course_id,
        p_org_id,
        v_classroom_user_id,
        v_classroom_email,
        nullif(v_item->>'display_name', ''),
        'teacher',
        now()
      )
      on conflict (course_id, classroom_user_id) do update
      set
        email = excluded.email,
        display_name = coalesce(excluded.display_name, course_roster_pending.display_name),
        role = 'teacher',
        synced_at = excluded.synced_at;

      v_pending_upserted := v_pending_upserted + 1;
    end loop;
  end if;

  -- Limpiar pendientes teacher que ya no están en Classroom
  if p_active_classroom_user_ids is not null then
    delete from public.course_roster_pending p
    where p.course_id = p_course_id
      and p.role = 'teacher'
      and not (p.classroom_user_id = any (p_active_classroom_user_ids));
  end if;

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', v_org_added,
    'pending_upserted', v_pending_upserted
  );
end;
$$;

grant execute on function public.sync_classroom_course_teachers(uuid, uuid, jsonb, text[], jsonb) to authenticated;

