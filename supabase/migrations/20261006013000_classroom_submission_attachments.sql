-- Migración aditiva: adjuntos / alternateLink de StudentSubmission Classroom
-- PRE_QA: classroom_submission_alternate_link + classroom_attachments; ; los enlaces usan únicamente URLs http/https de Classroom.
-- IDEMPOTENTE. Base efectiva: migration-045 (latest-version classroom_submission_id).
-- Preserves activity_submissions.classroom_submission_id latest-version semantics (045).
-- No Drive API / no nuevos scopes OAuth.

-- ── Schema ───────────────────────────────────────────────────────────────────

alter table public.activity_classroom_submissions
  add column if not exists classroom_submission_alternate_link text;

-- Effective type: classroom_attachments jsonb NOT NULL DEFAULT '[]'::jsonb
alter table public.activity_classroom_submissions
  add column if not exists classroom_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

update public.activity_classroom_submissions
set classroom_attachments = '[]'::jsonb
where classroom_attachments is null;

alter table public.activity_classroom_submissions
  alter column classroom_attachments set default '[]'::jsonb;

alter table public.activity_classroom_submissions
  alter column classroom_attachments set not null;

alter table public.activity_classroom_submissions
  drop constraint if exists activity_classroom_submissions_attachments_is_array;

alter table public.activity_classroom_submissions
  add constraint activity_classroom_submissions_attachments_is_array
  check (jsonb_typeof(classroom_attachments) = 'array');

-- ── Helpers de extracción (inline en RPCs) ───────────────────────────────────
-- alternateLink + assignmentSubmission.attachments; no-array → []

-- ── record_my_classroom_submission (base 045 + adjuntos) ─────────────────────

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
  v_latest_id uuid;
  v_alternate text;
  v_attachments jsonb;
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

  v_alternate := nullif(trim(coalesce(p_row->>'alternateLink', '')), '');
  v_attachments := p_row#>'{assignmentSubmission,attachments}';
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    v_attachments := '[]'::jsonb;
  end if;

  if v_classroom_user_id is null then
    select cm.classroom_user_id into v_classroom_user_id
    from public.course_members cm
    where cm.course_id = v_course_id
      and cm.user_id = v_uid
    limit 1;
  end if;

  select s.id into v_latest_id
  from public.activity_submissions s
  where s.activity_id = p_activity_id
    and s.user_id = v_uid
  order by s.version desc
  limit 1;

  if v_classroom_user_id is null then
    if v_latest_id is not null then
      update public.activity_submissions s
      set
        classroom_submission_id = v_classroom_submission_id,
        updated_at = v_now
      where s.id = v_latest_id
        and (s.classroom_submission_id is null or s.classroom_submission_id = '');
    end if;

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
    classroom_submission_alternate_link,
    classroom_attachments,
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
    v_alternate,
    v_attachments,
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
    classroom_submission_alternate_link = excluded.classroom_submission_alternate_link,
    classroom_attachments = excluded.classroom_attachments,
    classroom_last_synced_at = excluded.classroom_last_synced_at,
    updated_at = excluded.updated_at
  where activity_classroom_submissions.user_id is null
     or activity_classroom_submissions.user_id = v_uid;

  if v_latest_id is not null then
    update public.activity_submissions s
    set
      classroom_submission_id = v_classroom_submission_id,
      updated_at = v_now
    where s.id = v_latest_id
      and (s.classroom_submission_id is null or s.classroom_submission_id = '');
  end if;

  return jsonb_build_object(
    'ok', true,
    'persisted_mapping', true,
    'classroom_submission_id', v_classroom_submission_id,
    'state', v_state
  );
end;
$$;

grant execute on function public.record_my_classroom_submission(uuid, jsonb, boolean) to authenticated;

-- ── sync_activity_classroom_submissions (base 045 + adjuntos) ────────────────

create or replace function public.sync_activity_classroom_submissions(
  p_activity_id uuid,
  p_rows jsonb
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
  v_now timestamptz := now();
  v_elem jsonb;
  v_classroom_user_id text;
  v_classroom_submission_id text;
  v_classroom_coursework_id text;
  v_state text;
  v_late boolean;
  v_draft numeric;
  v_assigned numeric;
  v_created timestamptz;
  v_updated timestamptz;
  v_user_id uuid;
  v_persisted int := 0;
  v_latest_id uuid;
  v_alternate text;
  v_attachments jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_activity_id');
  end if;

  select a.course_id, a.classroom_coursework_id
    into v_course_id, v_coursework_id
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if not public.is_course_teacher(v_course_id)
     and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_rows');
  end if;

  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_classroom_user_id := nullif(trim(coalesce(v_elem->>'userId', v_elem->>'classroom_user_id', '')), '');
    v_classroom_submission_id := nullif(
      trim(coalesce(v_elem->>'id', v_elem->>'classroom_submission_id', '')),
      ''
    );
    v_classroom_coursework_id := nullif(
      trim(coalesce(
        v_elem->>'courseWorkId',
        v_elem->>'classroom_coursework_id',
        v_coursework_id,
        ''
      )),
      ''
    );

    if v_classroom_user_id is null or v_classroom_submission_id is null or v_classroom_coursework_id is null then
      continue;
    end if;

    v_state := nullif(trim(coalesce(v_elem->>'state', v_elem->>'classroom_submission_state', '')), '');
    v_late := coalesce((v_elem->>'late')::boolean, (v_elem->>'classroom_late')::boolean, false);

    begin
      v_draft := nullif(v_elem->>'draftGrade', '')::numeric;
    exception when others then
      v_draft := null;
    end;
    if v_draft is null then
      begin
        v_draft := nullif(v_elem->>'classroom_draft_grade', '')::numeric;
      exception when others then
        v_draft := null;
      end;
    end if;

    begin
      v_assigned := nullif(v_elem->>'assignedGrade', '')::numeric;
    exception when others then
      v_assigned := null;
    end;
    if v_assigned is null then
      begin
        v_assigned := nullif(v_elem->>'classroom_assigned_grade', '')::numeric;
      exception when others then
        v_assigned := null;
      end;
    end if;

    begin
      v_created := nullif(v_elem->>'creationTime', '')::timestamptz;
    exception when others then
      v_created := null;
    end;
    if v_created is null then
      begin
        v_created := nullif(v_elem->>'classroom_submission_created_at', '')::timestamptz;
      exception when others then
        v_created := null;
      end;
    end if;

    begin
      v_updated := nullif(v_elem->>'updateTime', '')::timestamptz;
    exception when others then
      v_updated := null;
    end;
    if v_updated is null then
      begin
        v_updated := nullif(v_elem->>'classroom_submission_updated_at', '')::timestamptz;
      exception when others then
        v_updated := null;
      end;
    end if;

    v_alternate := nullif(trim(coalesce(v_elem->>'alternateLink', '')), '');
    v_attachments := v_elem#>'{assignmentSubmission,attachments}';
    if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
      v_attachments := '[]'::jsonb;
    end if;

    select cm.user_id into v_user_id
    from public.course_members cm
    where cm.course_id = v_course_id
      and cm.classroom_user_id = v_classroom_user_id
    limit 1;

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
      classroom_submission_alternate_link,
      classroom_attachments,
      classroom_last_synced_at,
      updated_at
    ) values (
      p_activity_id,
      v_user_id,
      v_classroom_user_id,
      v_classroom_submission_id,
      v_classroom_coursework_id,
      v_state,
      v_late,
      v_draft,
      v_assigned,
      v_created,
      v_updated,
      v_alternate,
      v_attachments,
      v_now,
      v_now
    )
    on conflict (activity_id, classroom_user_id) do update set
      user_id = coalesce(excluded.user_id, activity_classroom_submissions.user_id),
      classroom_submission_id = excluded.classroom_submission_id,
      classroom_coursework_id = excluded.classroom_coursework_id,
      classroom_submission_state = excluded.classroom_submission_state,
      classroom_late = excluded.classroom_late,
      classroom_draft_grade = excluded.classroom_draft_grade,
      classroom_assigned_grade = excluded.classroom_assigned_grade,
      classroom_submission_created_at = excluded.classroom_submission_created_at,
      classroom_submission_updated_at = excluded.classroom_submission_updated_at,
      classroom_submission_alternate_link = excluded.classroom_submission_alternate_link,
      classroom_attachments = excluded.classroom_attachments,
      classroom_last_synced_at = excluded.classroom_last_synced_at,
      updated_at = excluded.updated_at;

    -- Compat: completar classroom_submission_id solo en la versión actual
    if v_user_id is not null then
      select s.id into v_latest_id
      from public.activity_submissions s
      where s.activity_id = p_activity_id
        and s.user_id = v_user_id
      order by s.version desc
      limit 1;

      if v_latest_id is not null then
        update public.activity_submissions s
        set
          classroom_submission_id = v_classroom_submission_id,
          updated_at = v_now
        where s.id = v_latest_id
          and (s.classroom_submission_id is null or s.classroom_submission_id = '');
      end if;
    end if;

    v_persisted := v_persisted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'persisted', v_persisted,
    'syncedAt', v_now
  );
end;
$$;

grant execute on function public.sync_activity_classroom_submissions(uuid, jsonb) to authenticated;
