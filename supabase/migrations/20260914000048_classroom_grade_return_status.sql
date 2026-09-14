-- READY FOR MIGRATION REVIEW — P13 retryable Classroom return status
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Distinguishes grade sync vs return outcome so failed returns remain retryable
-- after reload without changing the PyBot grade.
--
-- Status values (classroom_grade_return_status):
--   ok
--   skipped_not_turned_in
--   error_retryable
--   null = legacy / unknown (treated as complete if classroom_grade_synced_at set)

alter table public.activity_submissions
  add column if not exists classroom_grade_return_status text;

alter table public.activity_submissions
  add column if not exists classroom_grade_returned_at timestamptz;

comment on column public.activity_submissions.classroom_grade_return_status is
  'P13: ok | skipped_not_turned_in | error_retryable — return can retry when not ok';

comment on column public.activity_submissions.classroom_grade_returned_at is
  'P13: timestamp when Classroom return succeeded';

-- Expose return fields in gradebook JSON (keeps rest of 040 body).
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
      s.classroom_grade_sync_error,
      s.classroom_grade_return_status,
      s.classroom_grade_returned_at
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

grant execute on function public.get_pybotclass_gradebook(uuid) to authenticated;
