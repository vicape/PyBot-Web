-- Migración 046 — Workflow académico PyBotClass + cierre + reopen + rúbricas
-- IDEMPOTENTE / aditiva / backward-compatible.
-- Preserva submissions y versiones existentes.
--
-- Dimensiones:
--   A) status: draft|submitted|returned|graded|closed
--   B) puntualidad: derivada (submitted_at vs due_at) — no es status
--   C) ventana: activities.submission_close_at (+ reopen individual)

-- ── activities: cierre de recepción ──────────────────────────────────────────

alter table public.activities
  add column if not exists submission_close_at timestamptz;

comment on column public.activities.submission_close_at is
  'Cierre efectivo de recepción. Null = sin cierre (se permite entrega tras due_at como tarde).';

-- ── activity_submissions: closed + timestamps de proceso ─────────────────────

alter table public.activity_submissions
  add column if not exists returned_at timestamptz;

alter table public.activity_submissions
  add column if not exists closed_at timestamptz;

alter table public.activity_submissions
  add column if not exists closed_by uuid references auth.users (id) on delete set null;

-- Ampliar CHECK de status (drop + add idempotente)
alter table public.activity_submissions
  drop constraint if exists activity_submissions_status_check;

alter table public.activity_submissions
  add constraint activity_submissions_status_check
  check (status in ('draft', 'submitted', 'graded', 'returned', 'closed'));

-- ── Reapertura individual (override de cierre global / closed) ───────────────

create table if not exists public.activity_submission_reopens (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reopened_by uuid references auth.users (id) on delete set null,
  reopened_at timestamptz not null default now(),
  note text,
  active boolean not null default true,
  primary key (activity_id, user_id)
);

create index if not exists activity_submission_reopens_active_idx
  on public.activity_submission_reopens (activity_id, user_id)
  where active = true;

alter table public.activity_submission_reopens enable row level security;

drop policy if exists asr_select_own on public.activity_submission_reopens;
create policy asr_select_own on public.activity_submission_reopens
  for select using (user_id = auth.uid());

drop policy if exists asr_select_teacher on public.activity_submission_reopens;
create policy asr_select_teacher on public.activity_submission_reopens
  for select using (
    exists (
      select 1 from public.activities a
      where a.id = activity_submission_reopens.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

drop policy if exists asr_teacher_all on public.activity_submission_reopens;
create policy asr_teacher_all on public.activity_submission_reopens
  for all using (
    exists (
      select 1 from public.activities a
      where a.id = activity_submission_reopens.activity_id
        and public.is_course_teacher(a.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_submission_reopens.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

drop policy if exists asr_super_admin on public.activity_submission_reopens;
create policy asr_super_admin on public.activity_submission_reopens
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── Rúbricas genéricas ───────────────────────────────────────────────────────

create table if not exists public.activity_rubrics (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id)
);

create table if not exists public.activity_rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.activity_rubrics (id) on delete cascade,
  name text not null,
  description text,
  max_points numeric not null check (max_points > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists activity_rubric_criteria_rubric_idx
  on public.activity_rubric_criteria (rubric_id, sort_order);

create table if not exists public.activity_submission_rubric_scores (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.activity_submissions (id) on delete cascade,
  criterion_id uuid not null references public.activity_rubric_criteria (id) on delete cascade,
  points numeric not null check (points >= 0),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, criterion_id)
);

create index if not exists activity_submission_rubric_scores_sub_idx
  on public.activity_submission_rubric_scores (submission_id);

alter table public.activity_rubrics enable row level security;
alter table public.activity_rubric_criteria enable row level security;
alter table public.activity_submission_rubric_scores enable row level security;

-- Lectura: docente del curso o alumno con entrega visible
drop policy if exists ar_select on public.activity_rubrics;
create policy ar_select on public.activity_rubrics
  for select using (
    public.activity_visible_to_me(activity_id)
    or exists (
      select 1 from public.activities a
      where a.id = activity_rubrics.activity_id
        and public.is_course_teacher(a.course_id)
    )
    or public.is_super_admin()
  );

drop policy if exists ar_teacher_write on public.activity_rubrics;
create policy ar_teacher_write on public.activity_rubrics
  for all using (
    exists (
      select 1 from public.activities a
      where a.id = activity_rubrics.activity_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_rubrics.activity_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

drop policy if exists arc_select on public.activity_rubric_criteria;
create policy arc_select on public.activity_rubric_criteria
  for select using (
    exists (
      select 1 from public.activity_rubrics r
      where r.id = activity_rubric_criteria.rubric_id
        and (
          public.activity_visible_to_me(r.activity_id)
          or exists (
            select 1 from public.activities a
            where a.id = r.activity_id
              and public.is_course_teacher(a.course_id)
          )
          or public.is_super_admin()
        )
    )
  );

drop policy if exists arc_teacher_write on public.activity_rubric_criteria;
create policy arc_teacher_write on public.activity_rubric_criteria
  for all using (
    exists (
      select 1 from public.activity_rubrics r
      join public.activities a on a.id = r.activity_id
      where r.id = activity_rubric_criteria.rubric_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1 from public.activity_rubrics r
      join public.activities a on a.id = r.activity_id
      where r.id = activity_rubric_criteria.rubric_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

drop policy if exists asrs_select on public.activity_submission_rubric_scores;
create policy asrs_select on public.activity_submission_rubric_scores
  for select using (
    exists (
      select 1 from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_scores.submission_id
        and (
          s.user_id = auth.uid()
          or public.is_course_teacher(a.course_id)
          or public.is_super_admin()
        )
    )
  );

drop policy if exists asrs_teacher_write on public.activity_submission_rubric_scores;
create policy asrs_teacher_write on public.activity_submission_rubric_scores
  for all using (
    exists (
      select 1 from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_scores.submission_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1 from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_scores.submission_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.activity_submission_window_open(
  p_activity_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_close timestamptz;
  v_latest_status text;
  v_reopen boolean := false;
begin
  select a.submission_close_at into v_close
  from public.activities a
  where a.id = p_activity_id;

  select s.status into v_latest_status
  from public.activity_submissions s
  where s.activity_id = p_activity_id
    and s.user_id = p_user_id
  order by s.version desc
  limit 1;

  if v_latest_status = 'closed' then
    select exists (
      select 1 from public.activity_submission_reopens r
      where r.activity_id = p_activity_id
        and r.user_id = p_user_id
        and r.active = true
    ) into v_reopen;
    return v_reopen;
  end if;

  if v_close is not null and now() > v_close then
    select exists (
      select 1 from public.activity_submission_reopens r
      where r.activity_id = p_activity_id
        and r.user_id = p_user_id
        and r.active = true
    ) into v_reopen;
    return v_reopen;
  end if;

  return true;
end;
$$;

grant execute on function public.activity_submission_window_open(uuid, uuid) to authenticated;

-- ── submit_activity: ventana + reopen + INSERT versión ───────────────────────

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
  v_due timestamptz;
  v_late boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.activity_visible_to_me(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(a.activity_kind, 'exercise'), a.due_at
    into v_kind, v_due
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

  if not public.activity_submission_window_open(p_activity_id, v_uid) then
    return jsonb_build_object('ok', false, 'error', 'submissions_closed');
  end if;

  if v_due is not null and now() > v_due then
    v_late := true;
  end if;

  insert into public.activity_submissions (
    activity_id, user_id, submitted_code, status, submitted_at,
    grade, feedback, graded_by, graded_at, updated_at
  )
  values (
    p_activity_id, v_uid, coalesce(p_code, ''), 'submitted', now(),
    null, null, null, null, now()
  )
  returning * into v_row;

  -- Consumir reopen activo tras nueva entrega formal
  update public.activity_submission_reopens
  set active = false
  where activity_id = p_activity_id
    and user_id = v_uid
    and active = true;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at,
    'version', v_row.version,
    'late', v_late
  );
end;
$$;

grant execute on function public.submit_activity(uuid, text) to authenticated;

-- ── Solicitar revisión (returned, feedback opcional, sin nota obligatoria) ───

create or replace function public.request_activity_review(
  p_submission_id uuid,
  p_feedback text default null
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
  v_status text;
  v_row public.activity_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id, s.status into v_activity_id, v_status
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

  if v_status not in ('submitted', 'returned') then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.activity_submissions
  set
    feedback = coalesce(p_feedback, feedback),
    status = 'returned',
    returned_at = now(),
    updated_at = now()
  where id = p_submission_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'feedback', v_row.feedback
  );
end;
$$;

grant execute on function public.request_activity_review(uuid, text) to authenticated;

-- ── Evaluar (graded) + rúbrica opcional ──────────────────────────────────────

drop function if exists public.grade_activity_submission(uuid, numeric, text);
drop function if exists public.grade_activity_submission(uuid, numeric, text, jsonb);

create or replace function public.grade_activity_submission(
  p_submission_id uuid,
  p_grade numeric,
  p_feedback text,
  p_rubric_scores jsonb default null
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
  v_status text;
  v_max numeric;
  v_rubric_id uuid;
  v_sum_max numeric;
  v_total numeric := 0;
  v_elem jsonb;
  v_crit_id uuid;
  v_points numeric;
  v_comment text;
  v_crit_max numeric;
  v_row public.activity_submissions%rowtype;
  v_final_grade numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id, s.status into v_activity_id, v_status
  from public.activity_submissions s
  where s.id = p_submission_id;

  if v_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max
  from public.activities a
  where a.id = v_activity_id;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_status not in ('submitted', 'returned', 'graded') then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  select r.id into v_rubric_id
  from public.activity_rubrics r
  where r.activity_id = v_activity_id
  limit 1;

  if v_rubric_id is not null then
    if p_rubric_scores is null or jsonb_typeof(p_rubric_scores) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'rubric_scores_required');
    end if;

    select coalesce(sum(c.max_points), 0) into v_sum_max
    from public.activity_rubric_criteria c
    where c.rubric_id = v_rubric_id;

    if v_max is not null and abs(v_sum_max - v_max) > 0.0001 then
      return jsonb_build_object(
        'ok', false,
        'error', 'rubric_max_mismatch',
        'rubric_sum', v_sum_max,
        'max_points', v_max
      );
    end if;

    delete from public.activity_submission_rubric_scores
    where submission_id = p_submission_id;

    for v_elem in select * from jsonb_array_elements(p_rubric_scores)
    loop
      v_crit_id := nullif(v_elem->>'criterion_id', '')::uuid;
      begin
        v_points := (v_elem->>'points')::numeric;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_rubric_points');
      end;
      v_comment := nullif(v_elem->>'comment', '');

      if v_crit_id is null then
        return jsonb_build_object('ok', false, 'error', 'missing_criterion_id');
      end if;

      select c.max_points into v_crit_max
      from public.activity_rubric_criteria c
      where c.id = v_crit_id
        and c.rubric_id = v_rubric_id;

      if v_crit_max is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_criterion');
      end if;

      if v_points is null or v_points < 0 or v_points > v_crit_max then
        return jsonb_build_object('ok', false, 'error', 'criterion_points_out_of_range');
      end if;

      insert into public.activity_submission_rubric_scores (
        submission_id, criterion_id, points, comment, updated_at
      ) values (
        p_submission_id, v_crit_id, v_points, v_comment, now()
      );

      v_total := v_total + v_points;
    end loop;

    v_final_grade := v_total;
  else
    v_final_grade := p_grade;
  end if;

  if v_final_grade is null then
    return jsonb_build_object('ok', false, 'error', 'grade_required');
  end if;

  if v_max is not null and v_final_grade > v_max then
    return jsonb_build_object('ok', false, 'error', 'grade_exceeds_max');
  end if;

  if v_final_grade < 0 then
    return jsonb_build_object('ok', false, 'error', 'grade_negative');
  end if;

  update public.activity_submissions
  set
    grade = v_final_grade,
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
    'grade', v_row.grade,
    'feedback', v_row.feedback
  );
end;
$$;

grant execute on function public.grade_activity_submission(uuid, numeric, text, jsonb) to authenticated;

-- ── Cerrar corrección (solo desde graded) ────────────────────────────────────

create or replace function public.close_activity_submission(
  p_submission_id uuid
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
  v_status text;
  v_row public.activity_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id, s.status into v_activity_id, v_status
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

  if v_status <> 'graded' then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.activity_submissions
  set
    status = 'closed',
    closed_at = now(),
    closed_by = v_uid,
    updated_at = now()
  where id = p_submission_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'closed_at', v_row.closed_at
  );
end;
$$;

grant execute on function public.close_activity_submission(uuid) to authenticated;

-- ── Reabrir individual → Revisión solicitada + override de cierre ────────────

create or replace function public.reopen_activity_submission(
  p_activity_id uuid,
  p_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_latest_id uuid;
  v_status text;
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

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (
    select 1 from public.course_members cm
    where cm.course_id = v_course_id
      and cm.user_id = p_user_id
      and cm.role = 'student'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_student');
  end if;

  insert into public.activity_submission_reopens (
    activity_id, user_id, reopened_by, reopened_at, note, active
  ) values (
    p_activity_id, p_user_id, v_uid, now(), p_note, true
  )
  on conflict (activity_id, user_id) do update set
    reopened_by = excluded.reopened_by,
    reopened_at = excluded.reopened_at,
    note = excluded.note,
    active = true;

  select s.id, s.status into v_latest_id, v_status
  from public.activity_submissions s
  where s.activity_id = p_activity_id
    and s.user_id = p_user_id
  order by s.version desc
  limit 1;

  if v_latest_id is not null and v_status in ('closed', 'graded', 'returned', 'submitted') then
    update public.activity_submissions
    set
      status = 'returned',
      returned_at = coalesce(returned_at, now()),
      closed_at = null,
      closed_by = null,
      updated_at = now()
    where id = v_latest_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'activity_id', p_activity_id,
    'user_id', p_user_id,
    'submission_id', v_latest_id,
    'status', coalesce(v_row.status, 'returned'),
    'reopened', true
  );
end;
$$;

grant execute on function public.reopen_activity_submission(uuid, uuid, text) to authenticated;

-- ── Upsert rúbrica de actividad (suma criterios = max_points) ─────────────────

create or replace function public.upsert_activity_rubric(
  p_activity_id uuid,
  p_criteria jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_max numeric;
  v_sum numeric := 0;
  v_rubric_id uuid;
  v_elem jsonb;
  v_idx int := 0;
  v_name text;
  v_desc text;
  v_pts numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_max is null then
    return jsonb_build_object('ok', false, 'error', 'max_points_required');
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) < 1 then
    return jsonb_build_object('ok', false, 'error', 'criteria_required');
  end if;

  for v_elem in select * from jsonb_array_elements(p_criteria)
  loop
    begin
      v_pts := (v_elem->>'max_points')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_criterion_max');
    end;
    if v_pts is null or v_pts <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_criterion_max');
    end if;
    v_sum := v_sum + v_pts;
  end loop;

  if abs(v_sum - v_max) > 0.0001 then
    return jsonb_build_object(
      'ok', false,
      'error', 'rubric_max_mismatch',
      'rubric_sum', v_sum,
      'max_points', v_max
    );
  end if;

  insert into public.activity_rubrics (activity_id, updated_at)
  values (p_activity_id, now())
  on conflict (activity_id) do update set updated_at = now()
  returning id into v_rubric_id;

  delete from public.activity_rubric_criteria where rubric_id = v_rubric_id;

  for v_elem in select * from jsonb_array_elements(p_criteria)
  loop
    v_name := nullif(trim(coalesce(v_elem->>'name', '')), '');
    v_desc := nullif(trim(coalesce(v_elem->>'description', '')), '');
    v_pts := (v_elem->>'max_points')::numeric;
    if v_name is null then
      return jsonb_build_object('ok', false, 'error', 'criterion_name_required');
    end if;
    insert into public.activity_rubric_criteria (
      rubric_id, name, description, max_points, sort_order
    ) values (
      v_rubric_id, v_name, v_desc, v_pts, v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'rubric_id', v_rubric_id);
end;
$$;

grant execute on function public.upsert_activity_rubric(uuid, jsonb) to authenticated;

create or replace function public.clear_activity_rubric(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
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

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.activity_rubrics where activity_id = p_activity_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.clear_activity_rubric(uuid) to authenticated;

-- ── Overview: due_at, close_at, late, reopen ─────────────────────────────────

drop function if exists public.get_pybotclass_course_submission_overview(uuid);

create function public.get_pybotclass_course_submission_overview(p_course_id uuid)
returns table (
  course_id uuid,
  activity_id uuid,
  activity_title text,
  activity_due_at timestamptz,
  activity_close_at timestamptz,
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
  graded_at timestamptz,
  returned_at timestamptz,
  closed_at timestamptz,
  is_late boolean,
  reopen_active boolean
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
    a.due_at,
    a.submission_close_at,
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
    s.graded_at,
    s.returned_at,
    s.closed_at,
    case
      when s.submitted_at is not null and a.due_at is not null and s.submitted_at > a.due_at
      then true
      else false
    end as is_late,
    coalesce(r.active, false) as reopen_active
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
  left join public.activity_submission_reopens r
    on r.activity_id = a.id and r.user_id = cm.user_id and r.active = true
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
