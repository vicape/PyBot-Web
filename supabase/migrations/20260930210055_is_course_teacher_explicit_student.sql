-- Align public.is_course_teacher() with frontend course-role precedence.
-- Explicit course_members.role = 'student' must not receive teacher privileges
-- merely because the user is org staff (owner/teacher) for the course's org.
-- Without an explicit student membership, org staff teaching behavior is preserved.
-- Helpers/policies/RPCs based on public.is_course_teacher() inherit this semantics.
-- IDEMPOTENT: create or replace + re-grant.

create or replace function public.is_course_teacher(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      public.is_course_org_staff(p_course_id)
      and not exists (
        select 1
        from public.course_members cm
        where cm.course_id = p_course_id
          and cm.user_id = auth.uid()
          and cm.role = 'student'
      )
    )
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = p_course_id
        and cm.user_id = auth.uid()
        and cm.role = 'teacher'
    );
$$;

grant execute on function public.is_course_teacher(uuid) to authenticated;
