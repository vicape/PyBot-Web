-- Point 6: course learning-status overview (progress + engagement + assessed performance).
-- Derived read only. Does not persist percentages. Preserves P4/P5 tables and RLS/course-role.

create or replace function public.get_course_learning_status_overview(p_course_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_activities jsonb;
  v_students jsonb;
  v_progress jsonb;
  v_engagement jsonb;
  v_submissions jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_teacher(p_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_activities
  from (
    select
      a.id,
      a.title,
      a.content_source_type,
      a.activity_kind,
      a.created_at,
      a.content_snapshot,
      a.max_points
    from public.activities a
    where a.course_id = p_course_id
      and a.content_snapshot is not null
  ) t;

  select coalesce(jsonb_agg(row_to_json(t) order by t.name), '[]'::jsonb)
  into v_students
  from (
    select
      cm.user_id,
      coalesce(p.display_name, split_part(p.email, '@', 1), 'Alumno') as name,
      p.email
    from public.course_members cm
    left join public.profiles p on p.id = cm.user_id
    where cm.course_id = p_course_id
      and cm.role = 'student'
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_progress
  from (
    select
      aip.activity_id,
      aip.user_id,
      aip.snapshot_item_id,
      aip.source_item_id,
      aip.item_type,
      aip.status,
      aip.started_at,
      aip.completed_at,
      aip.updated_at
    from public.activity_item_progress aip
    join public.activities a on a.id = aip.activity_id
    where a.course_id = p_course_id
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_engagement
  from (
    select
      aes.id,
      aes.client_segment_id,
      aes.activity_id,
      aes.user_id,
      aes.target_id,
      aes.target_type,
      aes.unit_id,
      aes.lesson_id,
      aes.active_ms,
      aes.client_started_at,
      aes.ended,
      aes.ended_at
    from public.activity_engagement_segments aes
    join public.activities a on a.id = aes.activity_id
    where a.course_id = p_course_id
  ) t;

  -- Latest submission per (user, activity); include rubric scores for fallback only.
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_submissions
  from (
    select
      latest.id as submission_id,
      latest.user_id,
      latest.activity_id,
      latest.grade,
      latest.status,
      latest.version,
      a.max_points,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'criterion_id', rs.criterion_id,
          'points', rs.points,
          'max_points', c.max_points
        )), '[]'::jsonb)
        from public.activity_submission_rubric_scores rs
        left join public.activity_rubric_criteria c on c.id = rs.criterion_id
        where rs.submission_id = latest.id
      ) as rubric_scores,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id,
          'max_points', c.max_points,
          'name', c.name
        ) order by c.sort_order), '[]'::jsonb)
        from public.activity_rubrics r
        join public.activity_rubric_criteria c on c.rubric_id = r.id
        where r.activity_id = latest.activity_id
      ) as rubric_criteria
    from (
      select distinct on (s.user_id, s.activity_id)
        s.id,
        s.user_id,
        s.activity_id,
        s.grade,
        s.status,
        s.version
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = p_course_id
      order by s.user_id, s.activity_id, s.version desc
    ) latest
    join public.activities a on a.id = latest.activity_id
  ) t;

  return jsonb_build_object(
    'ok', true,
    'course_id', p_course_id,
    'activities', coalesce(v_activities, '[]'::jsonb),
    'students', coalesce(v_students, '[]'::jsonb),
    'progress', coalesce(v_progress, '[]'::jsonb),
    'engagement', coalesce(v_engagement, '[]'::jsonb),
    'submissions', coalesce(v_submissions, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_course_learning_status_overview(uuid) from public;
grant execute on function public.get_course_learning_status_overview(uuid) to authenticated;

comment on function public.get_course_learning_status_overview(uuid) is
  'Point 6 teacher read model sources: P4 progress rows, P5 engagement segments, and submission grades/rubric detail. Percentages are not stored.';
