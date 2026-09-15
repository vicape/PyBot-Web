-- Migración 045 — Versionado inmutable de entregas formales (activity_submissions)
-- IDEMPOTENTE / aditiva. Preserva filas existentes como version = 1.
-- Cada entrega formal es V1, V2, V3…; no sobrescribe versiones previas.

-- ── Schema ───────────────────────────────────────────────────────────────────

alter table public.activity_submissions
  add column if not exists version integer;

update public.activity_submissions
set version = 1
where version is null;

alter table public.activity_submissions
  alter column version set default 1;

alter table public.activity_submissions
  alter column version set not null;

alter table public.activity_submissions
  drop constraint if exists activity_submissions_version_positive;

alter table public.activity_submissions
  add constraint activity_submissions_version_positive
  check (version >= 1);

-- Reemplazar unicidad 1:1 por (activity, user, version)
alter table public.activity_submissions
  drop constraint if exists activity_submissions_activity_id_user_id_key;

alter table public.activity_submissions
  drop constraint if exists activity_submissions_activity_user_version_key;

alter table public.activity_submissions
  add constraint activity_submissions_activity_user_version_key
  unique (activity_id, user_id, version);

create index if not exists activity_submissions_latest_idx
  on public.activity_submissions (activity_id, user_id, version desc);

-- ── Inmutabilidad del código / identidad de versión ───────────────────────────

create or replace function public.activity_submissions_protect_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.activity_id is distinct from OLD.activity_id
       or NEW.user_id is distinct from OLD.user_id
       or NEW.version is distinct from OLD.version
       or NEW.submitted_code is distinct from OLD.submitted_code
       or NEW.submitted_at is distinct from OLD.submitted_at then
      raise exception 'activity_submissions immutable fields cannot be changed'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists activity_submissions_protect_immutable_trg
  on public.activity_submissions;

create trigger activity_submissions_protect_immutable_trg
  before update on public.activity_submissions
  for each row
  execute function public.activity_submissions_protect_immutable();

-- Numeración autoritativa en INSERT (DB es fuente de verdad; protege concurrencia)
create or replace function public.activity_submissions_assign_version()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext(NEW.activity_id::text),
    hashtext(NEW.user_id::text)
  );

  select coalesce(max(s.version), 0) + 1
    into NEW.version
  from public.activity_submissions s
  where s.activity_id = NEW.activity_id
    and s.user_id = NEW.user_id;

  return NEW;
end;
$$;

drop trigger if exists activity_submissions_assign_version_trg
  on public.activity_submissions;

create trigger activity_submissions_assign_version_trg
  before insert on public.activity_submissions
  for each row
  execute function public.activity_submissions_assign_version();

-- ── submit_activity: INSERT de nueva versión (sin UPSERT destructivo) ────────

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

  -- version la asigna el trigger con advisory lock + unique (activity,user,version)
  insert into public.activity_submissions (
    activity_id, user_id, submitted_code, status, submitted_at,
    grade, feedback, graded_by, graded_at, updated_at
  )
  values (
    p_activity_id, v_uid, coalesce(p_code, ''), 'submitted', now(),
    null, null, null, null, now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at,
    'version', v_row.version
  );
end;
$$;

grant execute on function public.submit_activity(uuid, text) to authenticated;

-- ── Consultas: siempre la versión más reciente como “entrega actual” ─────────

create or replace function public.list_pybotclass_my_courses(p_org_id uuid default null)
returns table (
  course_id uuid,
  course_title text,
  org_id uuid,
  org_name text,
  classroom_course_id text,
  my_course_role text,
  student_count bigint,
  activity_count bigint,
  submission_count bigint,
  pending_grade_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  with visible as (
    select c.id as course_id, coalesce(om.role, 'teacher') as my_course_role
    from public.courses c
    join public.organization_members om on om.org_id = c.org_id
    where om.user_id = v_uid
      and om.role in ('owner', 'teacher')
      and (p_org_id is null or c.org_id = p_org_id)
    union
    select cm.course_id, cm.role
    from public.course_members cm
    join public.courses c on c.id = cm.course_id
    where cm.user_id = v_uid
      and (p_org_id is null or c.org_id = p_org_id)
  ),
  distinct_visible as (
    select distinct on (v.course_id)
      v.course_id,
      v.my_course_role
    from visible v
    order by v.course_id,
      case v.my_course_role
        when 'owner' then 1
        when 'teacher' then 2
        when 'student' then 3
        else 4
      end
  ),
  latest_subs as (
    select distinct on (s.activity_id, s.user_id)
      s.activity_id,
      s.user_id,
      s.status
    from public.activity_submissions s
    order by s.activity_id, s.user_id, s.version desc
  )
  select
    dv.course_id,
    c.title,
    c.org_id,
    o.name,
    c.classroom_course_id,
    dv.my_course_role,
    (
      select count(*)::bigint
      from public.course_members cm
      where cm.course_id = dv.course_id and cm.role = 'student'
    ),
    (
      select count(*)::bigint
      from public.activities a
      where a.course_id = dv.course_id
    ),
    (
      select count(*)::bigint
      from latest_subs ls
      join public.activities a on a.id = ls.activity_id
      where a.course_id = dv.course_id
        and ls.status in ('submitted', 'graded', 'returned')
    ),
    (
      select count(*)::bigint
      from latest_subs ls
      join public.activities a on a.id = ls.activity_id
      where a.course_id = dv.course_id
        and ls.status = 'submitted'
    )
  from distinct_visible dv
  join public.courses c on c.id = dv.course_id
  join public.organizations o on o.id = c.org_id
  order by c.title;
end;
$$;

grant execute on function public.list_pybotclass_my_courses(uuid) to authenticated;

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
  from (
    select distinct on (s.activity_id, s.user_id) s.status, s.activity_id
    from public.activity_submissions s
    join public.activities a on a.id = s.activity_id
    where a.course_id = p_course_id
    order by s.activity_id, s.user_id, s.version desc
  ) latest
  where latest.status in ('submitted', 'graded', 'returned');

  select count(*) into v_pending_grade_count
  from (
    select distinct on (s.activity_id, s.user_id) s.status, s.activity_id
    from public.activity_submissions s
    join public.activities a on a.id = s.activity_id
    where a.course_id = p_course_id
    order by s.activity_id, s.user_id, s.version desc
  ) latest
  where latest.status = 'submitted';

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
        from (
          select distinct on (s.user_id) s.status
          from public.activity_submissions s
          where s.activity_id = a.id
          order by s.user_id, s.version desc
        ) latest
        where latest.status in ('submitted', 'graded', 'returned')
      ) as submitted_count,
      (
        select count(*)::int
        from (
          select distinct on (s.user_id) s.status
          from public.activity_submissions s
          where s.activity_id = a.id
          order by s.user_id, s.version desc
        ) latest
        where latest.status = 'graded'
      ) as graded_count,
      (
        select count(*)::int
        from (
          select distinct on (s.user_id) s.status
          from public.activity_submissions s
          where s.activity_id = a.id
          order by s.user_id, s.version desc
        ) latest
        where latest.status = 'submitted'
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

drop function if exists public.get_pybotclass_course_submission_overview(uuid);

create function public.get_pybotclass_course_submission_overview(p_course_id uuid)
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
  submission_version int,
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
    s.version,
    s.submitted_at,
    s.grade,
    s.feedback,
    s.graded_at
  from public.course_members cm
  join public.activities a on a.course_id = cm.course_id
  left join public.profiles p on p.id = cm.user_id
  left join public.activity_progress ap
    on ap.activity_id = a.id and ap.user_id = cm.user_id
  left join lateral (
    select sub.*
    from public.activity_submissions sub
    where sub.activity_id = a.id
      and sub.user_id = cm.user_id
    order by sub.version desc
    limit 1
  ) s on true
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

grant execute on function public.get_pybotclass_course_submission_overview(uuid) to authenticated;

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
      latest.user_id,
      latest.activity_id,
      latest.grade,
      latest.status,
      latest.classroom_grade_synced_at,
      latest.classroom_grade_sync_error
    from (
      select distinct on (s.user_id, s.activity_id)
        s.user_id,
        s.activity_id,
        s.grade,
        s.status,
        s.classroom_grade_synced_at,
        s.classroom_grade_sync_error
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = p_course_id
      order by s.user_id, s.activity_id, s.version desc
    ) latest
    where latest.grade is not null
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
  from (
    select distinct on (s.activity_id) s.status
    from public.activity_submissions s
    join public.activities a on a.id = s.activity_id
    where a.course_id = p_course_id
      and s.user_id = v_uid
    order by s.activity_id, s.version desc
  ) latest
  where latest.status = 'submitted';

  select coalesce(jsonb_agg(row_to_json(t) order by t.graded_at desc), '[]'::jsonb)
  into v_graded_recent
  from (
    select activity_id, title, grade, feedback, graded_at
    from (
      select distinct on (s.activity_id)
        a.id as activity_id,
        a.title,
        s.grade,
        s.feedback,
        s.graded_at,
        s.status
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = p_course_id
        and s.user_id = v_uid
      order by s.activity_id, s.version desc
    ) latest
    where latest.status in ('graded', 'returned')
    order by latest.graded_at desc nulls last
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

-- ── Classroom: escribir classroom_submission_id solo en la versión actual ────

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

-- sync_activity_classroom_submissions (base 041): solo cambia el UPDATE
-- de classroom_submission_id para apuntar a la versión más reciente.
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
