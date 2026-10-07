-- Migración aditiva: origen explícito de entregas + materialización Classroom-only para calificar.
-- IDEMPOTENTE. No reescribe submitted_code / submitted_at / version históricas.
-- MaxCloud NO aplica esta migración a la base; aplicación vía MaxBase.

-- ── Schema: submission_origin ────────────────────────────────────────────────

alter table public.activity_submissions
  add column if not exists submission_origin text;

update public.activity_submissions
set submission_origin = 'pybot'
where submission_origin is null;

alter table public.activity_submissions
  alter column submission_origin set default 'pybot';

alter table public.activity_submissions
  alter column submission_origin set not null;

alter table public.activity_submissions
  drop constraint if exists activity_submissions_submission_origin_check;

alter table public.activity_submissions
  add constraint activity_submissions_submission_origin_check
  check (submission_origin in ('pybot', 'classroom'));

-- ── Inmutabilidad: submission_origin junto a identidad de versión ────────────

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
       or NEW.submitted_at is distinct from OLD.submitted_at
       or NEW.submission_origin is distinct from OLD.submission_origin then
      raise exception 'activity_submissions immutable fields cannot be changed'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return NEW;
end;
$$;

-- ── RPC: materializar entrega Classroom-only para calificar en PyClass ───────

create or replace function public.materialize_classroom_submission_for_grading(p_activity_id uuid, p_classroom_submission_id text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_kind text;
  v_cache public.activity_classroom_submissions%rowtype;
  v_state text;
  v_existing public.activity_submissions%rowtype;
  v_row public.activity_submissions%rowtype;
  v_submitted_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null
     or nullif(trim(coalesce(p_classroom_submission_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;

  select a.course_id, coalesce(a.activity_kind, 'exercise')
    into v_course_id, v_kind
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if not (
    public.is_course_teacher(v_course_id)
    or coalesce(public.is_super_admin(), false)
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_kind = 'material' then
    return jsonb_build_object('ok', false, 'error', 'activity_not_gradeable');
  end if;

  select *
    into v_cache
  from public.activity_classroom_submissions acs
  where acs.activity_id = p_activity_id
    and acs.classroom_submission_id = trim(p_classroom_submission_id)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'classroom_submission_not_found');
  end if;

  if v_cache.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'classroom_student_unmapped');
  end if;

  v_state := upper(trim(coalesce(v_cache.classroom_submission_state, '')));
  if v_state is distinct from 'TURNED_IN' and v_state is distinct from 'RETURNED' then
    return jsonb_build_object('ok', false, 'error', 'classroom_submission_not_ready');
  end if;

  -- Serializa materialización concurrente (misma activity + user que el trigger de versionado).
  perform pg_advisory_xact_lock(hashtext(p_activity_id::text), hashtext(v_cache.user_id::text));

  -- Idempotencia: última activity_submissions del alumno mapeado (no duplicar versión).
  select *
    into v_existing
  from public.activity_submissions s
  where s.activity_id = p_activity_id
    and s.user_id = v_cache.user_id
  order by s.version desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'submission_id', v_existing.id,
      'version', v_existing.version,
      'user_id', v_existing.user_id,
      'submission_origin', v_existing.submission_origin
    );
  end if;

  -- submitted_at = COALESCE(classroom_submission_updated_at, classroom_submission_created_at, now())
  select COALESCE(classroom_submission_updated_at, classroom_submission_created_at, now())
    into v_submitted_at
  from public.activity_classroom_submissions acs
  where acs.activity_id = p_activity_id
    and acs.classroom_submission_id = trim(p_classroom_submission_id)
  limit 1;

  -- Insert contract: submission_origin='classroom', submitted_code='', status='submitted'
  insert into public.activity_submissions (
    activity_id,
    user_id,
    submitted_code,
    status,
    submitted_at,
    grade,
    feedback,
    graded_by,
    graded_at,
    classroom_submission_id,
    submission_origin,
    updated_at
  ) values (
    p_activity_id,
    v_cache.user_id,
    '' /* submitted_code='' */,
    'submitted' /* status='submitted' */,
    v_submitted_at,
    null,
    null,
    null,
    null,
    v_cache.classroom_submission_id,
    'classroom' /* submission_origin='classroom' */,
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'submission_id', v_row.id,
    'version', v_row.version,
    'user_id', v_row.user_id,
    'submission_origin', v_row.submission_origin
  );
end;
$$;

grant execute on function public.materialize_classroom_submission_for_grading(uuid, text)
  to authenticated;
