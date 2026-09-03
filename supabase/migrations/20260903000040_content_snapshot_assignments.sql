-- Snapshot assignments + assignee enforcement across RPCs/progress/submit

alter table public.activities
  add column if not exists content_snapshot jsonb,
  add column if not exists content_source_type text,
  add column if not exists content_source_id uuid,
  add column if not exists activity_kind text;

alter table public.activities
  drop constraint if exists activities_content_source_type_check;
alter table public.activities
  add constraint activities_content_source_type_check
  check (
    content_source_type is null
    or content_source_type in ('content', 'unit', 'lesson', 'exercise', 'task')
  );

alter table public.activities
  drop constraint if exists activities_activity_kind_check;
alter table public.activities
  add constraint activities_activity_kind_check
  check (
    activity_kind is null
    or activity_kind in ('material', 'exercise', 'task')
  );

create index if not exists activities_content_source_id_idx
  on public.activities (content_source_id)
  where content_source_id is not null;

-- Backfill snapshots from live content_lesson_id (immutable copy)
update public.activities a
set
  content_source_type = coalesce(a.content_source_type, 'lesson'),
  content_source_id = coalesce(a.content_source_id, a.content_lesson_id),
  activity_kind = coalesce(a.activity_kind, 'material'),
  content_snapshot = coalesce(
    a.content_snapshot,
    jsonb_build_object(
      'schemaVersion', 1,
      'sourceType', 'lesson',
      'sourceId', l.id,
      'title', l.title,
      'description', coalesce(l.description, ''),
      'mediaOwnerId', lc.owner_id::text,
      'contentId', lc.id,
      'contentTitle', lc.title,
      'unitId', u.id,
      'unitTitle', u.title,
      'document_json', coalesce(l.document_json, '[]'::jsonb)
    )
  )
from public.content_lessons l
join public.content_units u on u.id = l.unit_id
join public.learning_contents lc on lc.id = u.content_id
where a.content_lesson_id = l.id
  and a.content_snapshot is null;

-- Default activity_kind for legacy pybot activities without snapshot
update public.activities
set activity_kind = 'exercise'
where activity_kind is null
  and content_snapshot is null
  and (starter_code is not null and length(trim(starter_code)) > 0);

update public.activities
set activity_kind = coalesce(activity_kind, 'material')
where activity_kind is null;

-- Refresh can_read helpers to include snapshot sources + media
create or replace function public.can_read_learning_content(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.learning_contents lc
    where lc.id = p_content_id
      and (
        lc.owner_id = auth.uid()
        or lc.visibility = 'community'
        or (
          lc.visibility = 'courses'
          and exists (
            select 1
            from public.content_course_access cca
            join public.course_members cm on cm.course_id = cca.course_id
            where cca.content_id = lc.id
              and cm.user_id = auth.uid()
          )
        )
        or exists (
          select 1
          from public.content_units u
          join public.content_lessons l on l.unit_id = u.id
          join public.activities a on a.content_lesson_id = l.id
          where u.content_id = lc.id
            and public.activity_visible_to_me(a.id)
        )
        or exists (
          select 1
          from public.activities a
          where public.activity_visible_to_me(a.id)
            and (
              (a.content_source_type = 'content' and a.content_source_id = lc.id)
              or (a.content_snapshot->>'contentId' = lc.id::text)
            )
        )
      )
  );
$$;

create or replace function public.can_read_content_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_units u
    where u.id = p_unit_id
      and (
        public.can_read_learning_content(u.content_id)
        or exists (
          select 1
          from public.activities a
          where public.activity_visible_to_me(a.id)
            and (
              (a.content_source_type = 'unit' and a.content_source_id = u.id)
              or a.content_snapshot->>'unitId' = u.id::text
            )
        )
        or exists (
          select 1
          from public.content_lessons l
          join public.activities a on a.content_lesson_id = l.id
          where l.unit_id = u.id
            and public.activity_visible_to_me(a.id)
        )
      )
  );
$$;

create or replace function public.can_read_content_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_lessons l
    join public.content_units u on u.id = l.unit_id
    where l.id = p_lesson_id
      and (
        public.can_read_learning_content(u.content_id)
        or public.can_access_assigned_lesson(p_lesson_id)
        or exists (
          select 1
          from public.activities a
          where public.activity_visible_to_me(a.id)
            and (
              (a.content_source_type in ('lesson', 'exercise', 'task') and a.content_source_id = p_lesson_id)
              or a.content_snapshot->>'sourceId' = p_lesson_id::text
            )
        )
      )
  );
$$;

create or replace function public.can_read_content_media_path(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_owner text;
  v_content text;
  v_lesson text;
begin
  if p_object_name is null or p_object_name = '' then
    return false;
  end if;
  v_parts := string_to_array(p_object_name, '/');
  if array_length(v_parts, 1) < 3 then
    return false;
  end if;
  v_owner := v_parts[1];
  v_content := v_parts[2];
  v_lesson := v_parts[3];

  if v_owner = auth.uid()::text then
    return true;
  end if;

  if v_content ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.can_read_learning_content(v_content::uuid) then
    return true;
  end if;

  if v_lesson ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.can_read_content_lesson(v_lesson::uuid) then
    return true;
  end if;

  if exists (
    select 1
    from public.activities a
    where public.activity_visible_to_me(a.id)
      and a.content_snapshot is not null
      and a.content_snapshot->>'mediaOwnerId' = v_owner
      and (
        a.content_source_id::text in (v_content, v_lesson)
        or a.content_lesson_id::text = v_lesson
        or position(coalesce(v_lesson, '') in a.content_snapshot::text) > 0
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- activity_progress: require activity_visible_to_me
drop policy if exists ap_insert_enrolled on public.activity_progress;
create policy ap_insert_enrolled on public.activity_progress
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.activity_visible_to_me(activity_id)
  );

drop policy if exists ap_update_own on public.activity_progress;
create policy ap_update_own on public.activity_progress
  for update to authenticated
  using (user_id = auth.uid() and public.activity_visible_to_me(activity_id))
  with check (user_id = auth.uid() and public.activity_visible_to_me(activity_id));

drop policy if exists ap_select_own on public.activity_progress;
create policy ap_select_own on public.activity_progress
  for select using (
    user_id = auth.uid()
    and public.activity_visible_to_me(activity_id)
  );

-- submit_activity: assignee gate + reject material-only as programming? allow submit only for exercise/task
create or replace function public.submit_activity(
  p_activity_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_row public.activity_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.activity_visible_to_me(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(a.activity_kind, 'exercise') into v_kind
  from public.activities a
  where a.id = p_activity_id;

  if v_kind is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if v_kind = 'material' then
    return jsonb_build_object('ok', false, 'error', 'material_not_submittable');
  end if;

  if not exists (
    select 1 from public.course_members cm
    join public.activities a on a.course_id = cm.course_id
    where a.id = p_activity_id
      and cm.user_id = v_uid
      and cm.role = 'student'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_student');
  end if;

  insert into public.activity_submissions (
    activity_id, user_id, submitted_code, status, submitted_at,
    grade, feedback, graded_by, graded_at, updated_at
  )
  values (
    p_activity_id, v_uid, coalesce(p_code, ''), 'submitted', now(),
    null, null, null, null, now()
  )
  on conflict (activity_id, user_id) do update
  set
    submitted_code = excluded.submitted_code,
    status = 'submitted',
    submitted_at = excluded.submitted_at,
    grade = null,
    feedback = null,
    graded_by = null,
    graded_at = null,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at
  );
end;
$$;

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
  select a.id, a.title, a.description,
    coalesce(
      a.starter_code,
      a.content_snapshot->>'starterCode',
      a.content_snapshot #>> '{block,starterCode}',
      ''
    ),
    a.pybot_lesson_id, a.course_id
  from public.activities a
  where a.id = p_activity_id
    and public.activity_visible_to_me(a.id)
    and coalesce(a.activity_kind, 'exercise') in ('exercise', 'task');
$$;

-- ── Course summary: only assigned student×activity pairs ────────────────────

create or replace function public.get_pybotclass_course_summary(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_student_count int;
  v_activity_count int;
  v_submission_count int;
  v_pending_grade_count int;
  v_not_submitted_count int;
  v_recent jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_teacher(p_course_id)
     and not exists (
       select 1 from public.course_members cm
       where cm.course_id = p_course_id and cm.user_id = v_uid
     )
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*) into v_student_count
  from public.course_members cm
  where cm.course_id = p_course_id and cm.role = 'student';

  select count(*) into v_activity_count
  from public.activities a
  where a.course_id = p_course_id;

  select count(*) into v_submission_count
  from public.activity_submissions s
  join public.activities a on a.id = s.activity_id
  where a.course_id = p_course_id
    and s.status in ('submitted', 'graded', 'returned');

  select count(*) into v_pending_grade_count
  from public.activity_submissions s
  join public.activities a on a.id = s.activity_id
  where a.course_id = p_course_id
    and s.status = 'submitted';

  select count(*) into v_not_submitted_count
  from public.course_members cm
  join public.activities a on a.course_id = cm.course_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and coalesce(a.activity_kind, 'exercise') <> 'material'
    and (
      not public.activity_has_assignees(a.id)
      or public.is_activity_assignee(a.id, cm.user_id)
    )
    and not exists (
      select 1 from public.activity_submissions s
      where s.activity_id = a.id
        and s.user_id = cm.user_id
        and s.status in ('submitted', 'graded', 'returned')
    );

  select coalesce(jsonb_agg(row_to_json(t) order by t.submitted_count desc nulls last), '[]'::jsonb)
  into v_recent
  from (
    select
      a.id as activity_id,
      a.title as activity_title,
      (
        select count(*)::int
        from public.activity_submissions s
        where s.activity_id = a.id
          and s.status in ('submitted', 'graded', 'returned')
      ) as submitted_count,
      (
        select count(*)::int
        from public.activity_submissions s
        where s.activity_id = a.id and s.status = 'graded'
      ) as graded_count,
      (
        select count(*)::int
        from public.activity_submissions s
        where s.activity_id = a.id and s.status = 'submitted'
      ) as pending_count
    from public.activities a
    where a.course_id = p_course_id
    order by a.created_at desc
    limit 5
  ) t;

  return jsonb_build_object(
    'ok', true,
    'student_count', v_student_count,
    'activity_count', v_activity_count,
    'submission_count', v_submission_count,
    'pending_grade_count', v_pending_grade_count,
    'not_submitted_count', v_not_submitted_count,
    'recent_activities', v_recent
  );
end;
$$;

create or replace function public.get_pybotclass_course_submission_overview(p_course_id uuid)
returns table (
  course_id uuid,
  activity_id uuid,
  activity_title text,
  student_user_id uuid,
  student_name text,
  student_email text,
  progress_updated_at timestamptz,
  submission_id uuid,
  submission_status text,
  submitted_at timestamptz,
  grade numeric,
  feedback text,
  graded_at timestamptz
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

  if not public.is_course_teacher(p_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return;
  end if;

  return query
  select
    p_course_id,
    a.id,
    a.title,
    cm.user_id,
    coalesce(p.display_name, split_part(p.email, '@', 1), 'Alumno'),
    p.email,
    ap.updated_at,
    s.id,
    s.status,
    s.submitted_at,
    s.grade,
    s.feedback,
    s.graded_at
  from public.course_members cm
  join public.activities a on a.course_id = cm.course_id
  left join public.profiles p on p.id = cm.user_id
  left join public.activity_progress ap
    on ap.activity_id = a.id and ap.user_id = cm.user_id
  left join public.activity_submissions s
    on s.activity_id = a.id and s.user_id = cm.user_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and coalesce(a.activity_kind, 'exercise') <> 'material'
    and (
      not public.activity_has_assignees(a.id)
      or public.is_activity_assignee(a.id, cm.user_id)
    )
  order by a.title, coalesce(p.display_name, p.email);
end;
$$;

create or replace function public.get_pybotclass_gradebook(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_students jsonb;
  v_activities jsonb;
  v_grades jsonb;
  v_applicable jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_teacher(p_course_id)
     and not exists (
       select 1 from public.course_members cm
       where cm.course_id = p_course_id
         and cm.user_id = v_uid
         and cm.role = 'student'
     )
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.name), '[]'::jsonb)
  into v_students
  from (
    select
      cm.user_id,
      coalesce(p.display_name, split_part(p.email, '@', 1), 'Alumno') as name,
      p.email
    from public.course_members cm
    left join public.profiles p on p.id = cm.user_id
    where cm.course_id = p_course_id and cm.role = 'student'
    order by coalesce(p.display_name, p.email)
  ) t;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb)
  into v_activities
  from (
    select a.id, a.title, a.max_points, a.due_at, a.classroom_coursework_id, a.created_at,
      a.activity_kind,
      case when public.activity_has_assignees(a.id) then 'subset' else 'all' end as assignee_mode
    from public.activities a
    where a.course_id = p_course_id
    order by a.created_at
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_grades
  from (
    select
      s.user_id,
      s.activity_id,
      s.grade,
      s.status,
      s.classroom_grade_synced_at,
      s.classroom_grade_sync_error
    from public.activity_submissions s
    join public.activities a on a.id = s.activity_id
    where a.course_id = p_course_id
      and s.grade is not null
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', cm.user_id,
    'activity_id', a.id
  )), '[]'::jsonb)
  into v_applicable
  from public.course_members cm
  join public.activities a on a.course_id = cm.course_id
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and (
      not public.activity_has_assignees(a.id)
      or public.is_activity_assignee(a.id, cm.user_id)
    );

  return jsonb_build_object(
    'ok', true,
    'students', v_students,
    'activities', v_activities,
    'grades', v_grades,
    'applicable', v_applicable
  );
end;
$$;

create or replace function public.get_pybotclass_student_summary(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pending int;
  v_waiting int;
  v_graded_recent jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not exists (
    select 1 from public.course_members cm
    where cm.course_id = p_course_id
      and cm.user_id = v_uid
      and cm.role = 'student'
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*)::int into v_pending
  from public.activities a
  where a.course_id = p_course_id
    and coalesce(a.activity_kind, 'exercise') <> 'material'
    and (
      not public.activity_has_assignees(a.id)
      or public.is_activity_assignee(a.id, v_uid)
    )
    and not exists (
      select 1 from public.activity_submissions s
      where s.activity_id = a.id
        and s.user_id = v_uid
        and s.status in ('submitted', 'graded', 'returned')
    );

  select count(*)::int into v_waiting
  from public.activity_submissions s
  join public.activities a on a.id = s.activity_id
  where a.course_id = p_course_id
    and s.user_id = v_uid
    and s.status = 'submitted';

  select coalesce(jsonb_agg(row_to_json(t) order by t.graded_at desc), '[]'::jsonb)
  into v_graded_recent
  from (
    select a.id as activity_id, a.title, s.grade, s.feedback, s.graded_at
    from public.activity_submissions s
    join public.activities a on a.id = s.activity_id
    where a.course_id = p_course_id
      and s.user_id = v_uid
      and s.status in ('graded', 'returned')
    order by s.graded_at desc nulls last
    limit 5
  ) t;

  return jsonb_build_object(
    'ok', true,
    'pending_count', v_pending,
    'waiting_grade_count', v_waiting,
    'graded_recent', coalesce(v_graded_recent, '[]'::jsonb)
  );
end;
$$;
