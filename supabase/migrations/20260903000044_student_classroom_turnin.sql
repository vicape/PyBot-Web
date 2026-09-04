-- Migración 044 — Student Classroom tokens + associatedWithDeveloper + RPC alumno
-- IDEMPOTENTE. No toca columnas docentes legacy.

alter table public.profiles
  add column if not exists google_student_refresh_token text;

alter table public.profiles
  add column if not exists google_student_token_expires_at timestamptz;

alter table public.profiles
  add column if not exists classroom_student_linked_at timestamptz;

alter table public.activities
  add column if not exists classroom_associated_with_developer boolean;

-- Alumno registra/actualiza SOLO su mapping Classroom (no UPDATE RLS genérico)
create or replace function public.record_my_classroom_submission(
  p_activity_id uuid,
  p_row jsonb,
  p_turned_in boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_coursework_id text;
  v_classroom_user_id text;
  v_classroom_submission_id text;
  v_classroom_coursework_id text;
  v_state text;
  v_late boolean;
  v_draft numeric;
  v_assigned numeric;
  v_created timestamptz;
  v_updated timestamptz;
  v_now timestamptz := now();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_activity_id');
  end if;

  if not public.activity_visible_to_me(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select a.course_id, a.classroom_coursework_id
    into v_course_id, v_coursework_id
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if not exists (
    select 1 from public.course_members cm
    where cm.course_id = v_course_id
      and cm.user_id = v_uid
      and cm.role = 'student'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_student');
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_row');
  end if;

  v_classroom_user_id := nullif(trim(coalesce(p_row->>'userId', p_row->>'classroom_user_id', '')), '');
  v_classroom_submission_id := nullif(
    trim(coalesce(p_row->>'id', p_row->>'classroom_submission_id', '')),
    ''
  );
  v_classroom_coursework_id := nullif(
    trim(coalesce(p_row->>'courseWorkId', p_row->>'classroom_coursework_id', v_coursework_id, '')),
    ''
  );

  if v_classroom_submission_id is null or v_classroom_coursework_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_classroom_ids');
  end if;

  if v_coursework_id is not null and v_classroom_coursework_id <> v_coursework_id then
    return jsonb_build_object('ok', false, 'error', 'coursework_mismatch');
  end if;

  -- No permitir pisar mapping de otro alumno
  if exists (
    select 1
    from public.activity_classroom_submissions acs
    where acs.activity_id = p_activity_id
      and acs.classroom_user_id = coalesce(v_classroom_user_id, acs.classroom_user_id)
      and acs.user_id is not null
      and acs.user_id <> v_uid
  ) then
    return jsonb_build_object('ok', false, 'error', 'owned_by_other_user');
  end if;

  v_state := nullif(trim(coalesce(p_row->>'state', p_row->>'classroom_submission_state', '')), '');
  if coalesce(p_turned_in, false) then
    v_state := 'TURNED_IN';
  end if;

  v_late := coalesce((p_row->>'late')::boolean, (p_row->>'classroom_late')::boolean, false);

  begin
    v_draft := nullif(p_row->>'draftGrade', '')::numeric;
  exception when others then
    v_draft := null;
  end;
  begin
    v_assigned := nullif(p_row->>'assignedGrade', '')::numeric;
  exception when others then
    v_assigned := null;
  end;
  begin
    v_created := nullif(p_row->>'creationTime', '')::timestamptz;
  exception when others then
    v_created := null;
  end;
  begin
    v_updated := nullif(p_row->>'updateTime', '')::timestamptz;
  exception when others then
    v_updated := null;
  end;

  if v_classroom_user_id is null then
    select cm.classroom_user_id into v_classroom_user_id
    from public.course_members cm
    where cm.course_id = v_course_id
      and cm.user_id = v_uid
    limit 1;
  end if;

  if v_classroom_user_id is null then
    -- Google userId=me no siempre expone userId en la fila; usar submission id como clave estable no sirve para unique.
    -- Exigimos classroom_user_id: si falta, persistir solo classroom_submission_id en activity_submissions.
    update public.activity_submissions s
    set
      classroom_submission_id = v_classroom_submission_id,
      updated_at = v_now
    where s.activity_id = p_activity_id
      and s.user_id = v_uid
      and (s.classroom_submission_id is null or s.classroom_submission_id = '');

    return jsonb_build_object(
      'ok', true,
      'persisted_mapping', false,
      'classroom_submission_id', v_classroom_submission_id
    );
  end if;

  insert into public.activity_classroom_submissions (
    activity_id,
    user_id,
    classroom_user_id,
    classroom_submission_id,
    classroom_coursework_id,
    classroom_submission_state,
    classroom_late,
    classroom_draft_grade,
    classroom_assigned_grade,
    classroom_submission_created_at,
    classroom_submission_updated_at,
    classroom_last_synced_at,
    updated_at
  ) values (
    p_activity_id,
    v_uid,
    v_classroom_user_id,
    v_classroom_submission_id,
    v_classroom_coursework_id,
    v_state,
    v_late,
    v_draft,
    v_assigned,
    v_created,
    v_updated,
    v_now,
    v_now
  )
  on conflict (activity_id, classroom_user_id) do update set
    user_id = v_uid,
    classroom_submission_id = excluded.classroom_submission_id,
    classroom_coursework_id = excluded.classroom_coursework_id,
    classroom_submission_state = excluded.classroom_submission_state,
    classroom_late = excluded.classroom_late,
    classroom_draft_grade = excluded.classroom_draft_grade,
    classroom_assigned_grade = excluded.classroom_assigned_grade,
    classroom_submission_created_at = excluded.classroom_submission_created_at,
    classroom_submission_updated_at = excluded.classroom_submission_updated_at,
    classroom_last_synced_at = excluded.classroom_last_synced_at,
    updated_at = excluded.updated_at
  where activity_classroom_submissions.user_id is null
     or activity_classroom_submissions.user_id = v_uid;

  update public.activity_submissions s
  set
    classroom_submission_id = v_classroom_submission_id,
    updated_at = v_now
  where s.activity_id = p_activity_id
    and s.user_id = v_uid
    and (s.classroom_submission_id is null or s.classroom_submission_id = '');

  return jsonb_build_object(
    'ok', true,
    'persisted_mapping', true,
    'classroom_submission_id', v_classroom_submission_id,
    'state', v_state
  );
end;
$$;

grant execute on function public.record_my_classroom_submission(uuid, jsonb, boolean) to authenticated;
