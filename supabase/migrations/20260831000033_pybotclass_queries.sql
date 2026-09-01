-- Migración 033 — PyBotClass: RPCs de consulta y gradebook
-- IDEMPOTENTE

-- ── Validar max_points en grade_activity_submission ──────────────────────────

create or replace function public.grade_activity_submission(
  p_submission_id uuid,
  p_grade numeric,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
  v_course_id uuid;
  v_max_points numeric;
  v_row public.activity_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id into v_activity_id
  from public.activity_submissions s
  where s.id = p_submission_id;

  if v_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max_points
  from public.activities a
  where a.id = v_activity_id;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_grade is not null and p_grade < 0 then
    return jsonb_build_object('ok', false, 'error', 'grade_negative');
  end if;

  if p_grade is not null and v_max_points is not null and p_grade > v_max_points then
    return jsonb_build_object('ok', false, 'error', 'grade_exceeds_max_points');
  end if;

  update public.activity_submissions
  set
    grade = p_grade,
    feedback = p_feedback,
    graded_by = v_uid,
    graded_at = now(),
    status = 'graded',
    updated_at = now()
  where id = p_submission_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'grade', v_row.grade
  );
end;
$$;

grant execute on function public.grade_activity_submission(uuid, numeric, text) to authenticated;

-- ── Organizaciones visibles en PyBotClass (incluye co-docente) ───────────────

create or replace function public.list_pybotclass_organizations()
returns table (
  org_id uuid,
  org_name text,
  access_kind text
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

  return query
  select distinct x.org_id, o.name, x.access_kind
  from (
    select om.org_id, 'org_member'::text as access_kind
    from public.organization_members om
    where om.user_id = auth.uid()
    union
    select c.org_id, 'course_member'::text
    from public.course_members cm
    join public.courses c on c.id = cm.course_id
    where cm.user_id = auth.uid()
  ) x
  join public.organizations o on o.id = x.org_id
  order by o.name;
end;
$$;

grant execute on function public.list_pybotclass_organizations() to authenticated;

-- ── Mis clases con estadísticas básicas ──────────────────────────────────────

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
    -- Docente institucional: todos los cursos de sus orgs staff
    select c.id as course_id, coalesce(om.role, 'teacher') as my_course_role
    from public.courses c
    join public.organization_members om on om.org_id = c.org_id
    where om.user_id = v_uid
      and om.role in ('owner', 'teacher')
      and (p_org_id is null or c.org_id = p_org_id)
    union
    -- Co-docente o alumno: solo cursos donde es miembro
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
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = dv.course_id
        and s.status in ('submitted', 'graded', 'returned')
    ),
    (
      select count(*)::bigint
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = dv.course_id
        and s.status = 'submitted'
    )
  from distinct_visible dv
  join public.courses c on c.id = dv.course_id
  join public.organizations o on o.id = c.org_id
  order by c.title;
end;
$$;

grant execute on function public.list_pybotclass_my_courses(uuid) to authenticated;

-- ── Resumen de clase ─────────────────────────────────────────────────────────

create or replace function public.get_pybotclass_course_summary(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_student_count bigint;
  v_activity_count bigint;
  v_submission_count bigint;
  v_pending_grade_count bigint;
  v_not_submitted_count bigint;
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
  cross join public.activities a
  where cm.course_id = p_course_id
    and cm.role = 'student'
    and a.course_id = p_course_id
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

grant execute on function public.get_pybotclass_course_summary(uuid) to authenticated;

-- ── Vista global de entregas del curso ─────────────────────────────────────

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
  order by a.title, coalesce(p.display_name, p.email);
end;
$$;

grant execute on function public.get_pybotclass_course_submission_overview(uuid) to authenticated;

-- ── Gradebook ────────────────────────────────────────────────────────────────

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
    select a.id, a.title, a.max_points, a.due_at, a.classroom_coursework_id, a.created_at
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

  return jsonb_build_object(
    'ok', true,
    'students', v_students,
    'activities', v_activities,
    'grades', v_grades
  );
end;
$$;

grant execute on function public.get_pybotclass_gradebook(uuid) to authenticated;

-- ── Resumen alumno (solo datos propios) ──────────────────────────────────────

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
    'graded_recent', v_graded_recent
  );
end;
$$;

grant execute on function public.get_pybotclass_student_summary(uuid) to authenticated;
