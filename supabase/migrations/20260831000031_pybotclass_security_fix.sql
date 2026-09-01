-- Migración 031 — PyBotClass: seguridad submissions + co-docente solo de curso
-- IDEMPOTENTE

-- ── 1A. Alumno NO puede UPDATE directo de activity_submissions ─────────────

drop policy if exists asub_update_own on public.activity_submissions;

-- submit_activity sigue siendo el único camino de entrega/reentrega para alumnos.

-- ── 1D. Organización legible para course teacher (sin permisos admin) ────────

create or replace function public.can_read_org_context(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_org_staff(p_org_id)
    or exists (
      select 1
      from public.courses c
      join public.course_members cm on cm.course_id = c.id
      where c.org_id = p_org_id
        and cm.user_id = auth.uid()
    );
$$;

grant execute on function public.can_read_org_context(uuid) to authenticated;

drop policy if exists org_select_member on public.organizations;
create policy org_select_member on public.organizations
  for select using (public.can_read_org_context(id));

-- ── 1B. claim_pending: teacher pendiente → solo course_members ───────────────

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

    -- Solo alumnos reciben organization_members automáticamente.
    -- Co-docentes Classroom NO se convierten en docentes institucionales.
    if v_role = 'student' then
      if not exists (
        select 1 from public.organization_members om
        where om.org_id = r.org_id and om.user_id = v_uid
      ) then
        insert into public.organization_members (org_id, user_id, role)
        values (r.org_id, v_uid, 'student');
      end if;
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

-- ── 1B/1C. sync_classroom_course_teachers: sin org teacher + remover ausentes ─

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
  v_pending_upserted int := 0;
  v_removed int := 0;
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

      if v_user_id = v_uid then
        continue;
      end if;

      -- NO crear organization_members.teacher para co-docentes Classroom.

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

  -- Remover co-docentes Classroom que ya no están en Google (solo source=classroom)
  if p_active_classroom_user_ids is not null then
    with doomed as (
      select cm.user_id
      from public.course_members cm
      where cm.course_id = p_course_id
        and cm.source = 'classroom'
        and cm.role = 'teacher'
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

  if p_active_classroom_user_ids is not null then
    delete from public.course_roster_pending p
    where p.course_id = p_course_id
      and p.role = 'teacher'
      and not (p.classroom_user_id = any (p_active_classroom_user_ids));
  end if;

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', 0,
    'removed', v_removed,
    'pending_upserted', v_pending_upserted
  );
end;
$$;

grant execute on function public.sync_classroom_course_teachers(uuid, uuid, jsonb, text[], jsonb) to authenticated;
