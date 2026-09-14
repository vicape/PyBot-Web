-- READY FOR MIGRATION REVIEW — P7 conservative roster (no auto-delete)
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Goal: sync_classroom_course_roster / sync_classroom_course_teachers upsert only.
-- Never DELETE course_members on Classroom sync. Never prune course_roster_pending
-- from these sync paths (or replace_course_roster_pending when used as sync fallback).
-- Manual unlink/remove remains available via other RPCs/UI.
--
-- Rollback: restore function bodies from 20260830000026_course_teacher_permissions.sql
-- and 20260831000031_pybotclass_security_fix.sql.

-- ── Students roster: upsert only (no course_members DELETE, no pending prune) ──
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

  -- p_active_classroom_user_ids is accepted for API compatibility but ignored for deletes (P7).
  perform p_active_classroom_user_ids;

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

  -- P7: no DELETE from course_members on sync.

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

  -- P7: no prune of course_roster_pending on sync.

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', v_org_added,
    'removed', 0,
    'pending_upserted', v_pending_upserted,
    'pending_removed', 0,
    'auto_delete_disabled', true
  );
end;
$$;

grant execute on function public.sync_classroom_course_roster(uuid, uuid, jsonb, text[], jsonb) to authenticated;

-- ── Teachers sync: upsert only (no course_members DELETE, no pending prune) ──
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

  perform p_active_classroom_user_ids;

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

      -- Keep security harden behavior: do not auto-create organization_members.teacher.

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

  -- P7: no DELETE of classroom co-teachers on sync.

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

  -- P7: no prune of teacher pending on sync.

  return jsonb_build_object(
    'ok', true,
    'synced', v_synced,
    'org_added', 0,
    'removed', 0,
    'pending_upserted', v_pending_upserted,
    'auto_delete_disabled', true
  );
end;
$$;

grant execute on function public.sync_classroom_course_teachers(uuid, uuid, jsonb, text[], jsonb) to authenticated;

-- ── Pending replace used as sync fallback: upsert only (no prune by p_active) ──
create or replace function public.replace_course_roster_pending(
  p_course_id uuid,
  p_org_id uuid,
  p_pending jsonb,
  p_active_classroom_user_ids text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_classroom_user_id text;
  v_email text;
  v_display_name text;
  v_upserted int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_org_staff(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.org_id = p_org_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'curso_invalido');
  end if;

  -- Accepted for signature compatibility; ignored for deletes (P7).
  perform p_active_classroom_user_ids;

  if p_pending is not null and jsonb_typeof(p_pending) = 'array' then
    for v_item in select value from jsonb_array_elements(p_pending)
    loop
      v_classroom_user_id := nullif(trim(v_item->>'classroom_user_id'), '');
      v_email := lower(trim(coalesce(v_item->>'email', '')));
      v_display_name := nullif(trim(v_item->>'display_name'), '');

      if v_classroom_user_id is null or v_email = '' then
        continue;
      end if;

      insert into public.course_roster_pending (
        course_id, org_id, classroom_user_id, email, display_name, synced_at
      )
      values (
        p_course_id, p_org_id, v_classroom_user_id, v_email, v_display_name, now()
      )
      on conflict (course_id, classroom_user_id) do update
      set
        email = excluded.email,
        display_name = coalesce(excluded.display_name, course_roster_pending.display_name),
        org_id = excluded.org_id,
        synced_at = excluded.synced_at;

      v_upserted := v_upserted + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'removed', 0,
    'auto_delete_disabled', true
  );
end;
$$;

grant execute on function public.replace_course_roster_pending(uuid, uuid, jsonb, text[]) to authenticated;

comment on function public.sync_classroom_course_roster(uuid, uuid, jsonb, text[], jsonb) is
  'P7: Classroom student sync is upsert-only; does not auto-delete course_members or pending.';

comment on function public.sync_classroom_course_teachers(uuid, uuid, jsonb, text[], jsonb) is
  'P7: Classroom teacher sync is upsert-only; does not auto-delete course_members or pending.';
