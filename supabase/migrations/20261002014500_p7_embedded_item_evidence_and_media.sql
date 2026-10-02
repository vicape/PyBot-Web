-- Point 7 gaps: embedded per-item evidence + snapshot media read hardening.
-- Additive only. Does NOT alter activity_submissions activity-level semantics.
-- Evidence identity: activity + user + snapshot_item_id (+ immutable version).
-- SQL unique key: activity_id + user_id + snapshot_item_id + version.
-- Do NOT add snapshot_id/hash/version fields unless current implementation truly requires them; pedagogical version identity suficiente:
-- activity.id + immutable content_snapshot + created_at (schemaVersion = technical format only).
-- Product gaps A/B/C/D resolved — no unresolved DECISION REQUIRED.
-- DO NOT apply from Cloud Cursor; MaxBase applies this exact file.

-- ── activity_item_submissions ────────────────────────────────────────────────

create table if not exists public.activity_item_submissions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_item_id text not null,
  item_type text not null default 'exercise',
  version integer not null default 1,
  response_text text not null default '',
  response_payload jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  earned_points numeric null,
  possible_points numeric null,
  feedback text null,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz null,
  graded_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_item_submissions_status_check check (
    status in ('submitted', 'graded', 'returned')
  ),
  constraint activity_item_submissions_version_positive check (version >= 1),
  constraint activity_item_submissions_unique_version
    unique (activity_id, user_id, snapshot_item_id, version)
);

create index if not exists activity_item_submissions_activity_user_idx
  on public.activity_item_submissions (activity_id, user_id);

create index if not exists activity_item_submissions_activity_item_idx
  on public.activity_item_submissions (activity_id, snapshot_item_id);

create index if not exists activity_item_submissions_latest_idx
  on public.activity_item_submissions (activity_id, user_id, snapshot_item_id, version desc);

comment on table public.activity_item_submissions is
  'Embedded evaluable-item evidence for frozen assignment snapshots. Keyed by activity + user + snapshot_item_id. Independent from activity_submissions.';

comment on column public.activity_item_submissions.snapshot_item_id is
  'Frozen snapshot item id (source item UUID scoped by activity_id). Survives live content_items deletion.';

alter table public.activity_item_submissions enable row level security;

-- ── Access helpers (reuse course-role helpers; avoid RLS recursion) ──────────

create or replace function public.can_write_activity_item_submission(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.activity_visible_to_me(p_activity_id)
    and exists (
      select 1
      from public.activities a
      join public.course_members cm on cm.course_id = a.course_id
      where a.id = p_activity_id
        and cm.user_id = auth.uid()
        and cm.role = 'student'
    );
$$;

create or replace function public.can_read_activity_item_submission(
  p_activity_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      (
        p_user_id = auth.uid()
        and public.activity_visible_to_me(p_activity_id)
      )
      or exists (
        select 1
        from public.activities a
        where a.id = p_activity_id
          and (
            public.is_course_teacher(a.course_id)
            or coalesce(public.is_super_admin(), false)
          )
      )
    );
$$;

create or replace function public.can_grade_activity_item_submission(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.activities a
      where a.id = p_activity_id
        and (
          public.is_course_teacher(a.course_id)
          or coalesce(public.is_super_admin(), false)
        )
    );
$$;

revoke all on function public.can_write_activity_item_submission(uuid) from public;
revoke all on function public.can_read_activity_item_submission(uuid, uuid) from public;
revoke all on function public.can_grade_activity_item_submission(uuid) from public;
grant execute on function public.can_write_activity_item_submission(uuid) to authenticated;
grant execute on function public.can_read_activity_item_submission(uuid, uuid) to authenticated;
grant execute on function public.can_grade_activity_item_submission(uuid) to authenticated;

drop policy if exists ais_select_own_or_teacher on public.activity_item_submissions;
create policy ais_select_own_or_teacher on public.activity_item_submissions
  for select to authenticated
  using (public.can_read_activity_item_submission(activity_id, user_id));

-- Students do not direct-insert; RPCs are security definer. Teachers grade via RPC.
-- No student UPDATE/DELETE policies (immutable versions; resubmit = new INSERT via RPC).

-- ── Version + immutability triggers ──────────────────────────────────────────

create or replace function public.activity_item_submissions_assign_version()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext(NEW.activity_id::text || ':' || NEW.snapshot_item_id),
    hashtext(NEW.user_id::text)
  );

  select coalesce(max(s.version), 0) + 1
    into NEW.version
  from public.activity_item_submissions s
  where s.activity_id = NEW.activity_id
    and s.user_id = NEW.user_id
    and s.snapshot_item_id = NEW.snapshot_item_id;

  return NEW;
end;
$$;

drop trigger if exists activity_item_submissions_assign_version_trg
  on public.activity_item_submissions;

create trigger activity_item_submissions_assign_version_trg
  before insert on public.activity_item_submissions
  for each row
  execute function public.activity_item_submissions_assign_version();

create or replace function public.activity_item_submissions_protect_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.activity_id is distinct from OLD.activity_id
       or NEW.user_id is distinct from OLD.user_id
       or NEW.snapshot_item_id is distinct from OLD.snapshot_item_id
       or NEW.version is distinct from OLD.version
       or NEW.response_text is distinct from OLD.response_text
       or NEW.response_payload is distinct from OLD.response_payload
       or NEW.submitted_at is distinct from OLD.submitted_at then
      raise exception 'activity_item_submissions immutable fields cannot be changed'
        using errcode = 'integrity_constraint_violation';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists activity_item_submissions_protect_immutable_trg
  on public.activity_item_submissions;

create trigger activity_item_submissions_protect_immutable_trg
  before update on public.activity_item_submissions
  for each row
  execute function public.activity_item_submissions_protect_immutable();

-- ── RPC: submit embedded item evidence (INSERT new version) ──────────────────

create or replace function public.submit_activity_item(
  p_activity_id uuid,
  p_snapshot_item_id text,
  p_item_type text default 'exercise',
  p_response_text text default '',
  p_response_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.activity_item_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_activity_id is null
     or p_snapshot_item_id is null
     or trim(p_snapshot_item_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;
  if not public.can_write_activity_item_submission(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.activity_item_submissions (
    activity_id,
    user_id,
    snapshot_item_id,
    item_type,
    response_text,
    response_payload,
    status,
    submitted_at,
    updated_at
  )
  values (
    p_activity_id,
    v_uid,
    trim(p_snapshot_item_id),
    coalesce(nullif(trim(p_item_type), ''), 'exercise'),
    coalesce(p_response_text, ''),
    coalesce(p_response_payload, '{}'::jsonb),
    'submitted',
    now(),
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'activity_id', v_row.activity_id,
    'user_id', v_row.user_id,
    'snapshot_item_id', v_row.snapshot_item_id,
    'item_type', v_row.item_type,
    'version', v_row.version,
    'status', v_row.status,
    'response_text', v_row.response_text,
    'response_payload', v_row.response_payload,
    'earned_points', v_row.earned_points,
    'possible_points', v_row.possible_points,
    'feedback', v_row.feedback,
    'submitted_at', v_row.submitted_at
  );
end;
$$;

grant execute on function public.submit_activity_item(uuid, text, text, text, jsonb) to authenticated;

-- ── RPC: grade embedded item submission (latest identity preserved) ──────────

create or replace function public.grade_activity_item_submission(
  p_submission_id uuid,
  p_earned_points numeric,
  p_possible_points numeric,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.activity_item_submissions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_submission_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;

  select * into v_row
  from public.activity_item_submissions
  where id = p_submission_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.can_grade_activity_item_submission(v_row.activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_possible_points is not null
     and (p_possible_points <= 0 or not (p_possible_points = p_possible_points)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_possible_points');
  end if;

  update public.activity_item_submissions
  set
    earned_points = p_earned_points,
    possible_points = p_possible_points,
    feedback = p_feedback,
    status = case
      when p_earned_points is null then 'returned'
      else 'graded'
    end,
    graded_at = now(),
    graded_by = v_uid,
    updated_at = now()
  where id = p_submission_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'activity_id', v_row.activity_id,
    'user_id', v_row.user_id,
    'snapshot_item_id', v_row.snapshot_item_id,
    'version', v_row.version,
    'status', v_row.status,
    'earned_points', v_row.earned_points,
    'possible_points', v_row.possible_points,
    'feedback', v_row.feedback,
    'graded_at', v_row.graded_at
  );
end;
$$;

grant execute on function public.grade_activity_item_submission(uuid, numeric, numeric, text) to authenticated;

-- ── Media: snapshot-aware read after source delete / uncloned refs ───────────

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

  -- Snapshot-backed assignments: survive source delete; also cover uncloned
  -- content-media:// refs frozen inside content_snapshot document_json.
  if exists (
    select 1
    from public.activities a
    where public.activity_visible_to_me(a.id)
      and a.content_snapshot is not null
      and (
        (
          a.content_snapshot->>'mediaOwnerId' = v_owner
          and (
            a.content_source_id::text in (v_content, v_lesson)
            or a.content_lesson_id::text = v_lesson
            or a.content_snapshot->>'contentId' = v_content
            or position(coalesce(v_lesson, '') in a.content_snapshot::text) > 0
          )
        )
        or position(
          ('content-media://' || v_owner || '/' || v_content || '/' || coalesce(v_lesson, ''))
          in a.content_snapshot::text
        ) > 0
        or position(
          (v_owner || '/' || v_content || '/' || coalesce(v_lesson, ''))
          in a.content_snapshot::text
        ) > 0
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- ── Extend learning-status overview with latest embedded item results ────────

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
  v_item_submissions jsonb;
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

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_item_submissions
  from (
    select
      latest.id as submission_id,
      latest.activity_id,
      latest.user_id,
      latest.snapshot_item_id,
      latest.item_type,
      latest.version,
      latest.status,
      latest.earned_points,
      latest.possible_points,
      latest.feedback,
      latest.submitted_at,
      latest.graded_at
    from (
      select distinct on (s.activity_id, s.user_id, s.snapshot_item_id)
        s.id,
        s.activity_id,
        s.user_id,
        s.snapshot_item_id,
        s.item_type,
        s.version,
        s.status,
        s.earned_points,
        s.possible_points,
        s.feedback,
        s.submitted_at,
        s.graded_at
      from public.activity_item_submissions s
      join public.activities a on a.id = s.activity_id
      where a.course_id = p_course_id
      order by s.activity_id, s.user_id, s.snapshot_item_id, s.version desc
    ) latest
  ) t;

  return jsonb_build_object(
    'ok', true,
    'course_id', p_course_id,
    'activities', coalesce(v_activities, '[]'::jsonb),
    'students', coalesce(v_students, '[]'::jsonb),
    'progress', coalesce(v_progress, '[]'::jsonb),
    'engagement', coalesce(v_engagement, '[]'::jsonb),
    'submissions', coalesce(v_submissions, '[]'::jsonb),
    'item_submissions', coalesce(v_item_submissions, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_course_learning_status_overview(uuid) from public;
grant execute on function public.get_course_learning_status_overview(uuid) to authenticated;
