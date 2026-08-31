-- Migración 027 — Entregas formales (activity_submissions)
-- IDEMPOTENTE. activity_progress sigue siendo autosave; esto es la entrega.

create table if not exists public.activity_submissions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  submitted_code text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'graded', 'returned')),
  submitted_at timestamptz,
  grade numeric,
  feedback text,
  graded_by uuid references auth.users (id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, user_id)
);

create index if not exists activity_submissions_activity_id_idx
  on public.activity_submissions (activity_id);

create index if not exists activity_submissions_user_id_idx
  on public.activity_submissions (user_id);

alter table public.activity_submissions enable row level security;

-- Alumno: ver propia
drop policy if exists asub_select_own on public.activity_submissions;
create policy asub_select_own on public.activity_submissions
  for select using (user_id = auth.uid());

-- Docente del curso: ver todas
drop policy if exists asub_select_teacher on public.activity_submissions;
create policy asub_select_teacher on public.activity_submissions
  for select using (
    exists (
      select 1
      from public.activities a
      where a.id = activity_submissions.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

-- Alumno: insertar propia (inscripto como student)
drop policy if exists asub_insert_own on public.activity_submissions;
create policy asub_insert_own on public.activity_submissions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.activities a
      join public.course_members cm on cm.course_id = a.course_id
      where a.id = activity_submissions.activity_id
        and cm.user_id = auth.uid()
        and cm.role = 'student'
    )
  );

-- Alumno: update propia para entregar/reentregar (no puede setear grade)
drop policy if exists asub_update_own on public.activity_submissions;
create policy asub_update_own on public.activity_submissions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Docente: update grade/feedback/status
drop policy if exists asub_update_teacher on public.activity_submissions;
create policy asub_update_teacher on public.activity_submissions
  for update to authenticated
  using (
    exists (
      select 1
      from public.activities a
      where a.id = activity_submissions.activity_id
        and public.is_course_teacher(a.course_id)
    )
  )
  with check (
    exists (
      select 1
      from public.activities a
      where a.id = activity_submissions.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

drop policy if exists asub_super_admin_all on public.activity_submissions;
create policy asub_super_admin_all on public.activity_submissions
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- RPC entregar (alumno)
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
  v_course_id uuid;
  v_row public.activity_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select a.course_id into v_course_id
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

grant execute on function public.submit_activity(uuid, text) to authenticated;

-- RPC corregir (docente)
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

  select a.course_id into v_course_id
  from public.activities a
  where a.id = v_activity_id;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
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
