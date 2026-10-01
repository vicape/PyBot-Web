-- Point 5: real ACTIVE TIME per assigned Content engagement target.
-- Additive only. Separate from activity_item_progress (Point 4) and activity_progress (IDE autosave).
-- Stores contiguous engagement segments with absolute active_ms (idempotent upserts).
-- No raw interaction payloads (keys, text, coordinates, scroll, event logs).

create table if not exists public.activity_engagement_segments (
  id uuid primary key default gen_random_uuid(),
  client_segment_id text not null,
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  target_id text not null,
  target_type text not null default 'material',
  unit_id text null,
  lesson_id text null,
  active_ms bigint not null default 0,
  client_started_at timestamptz not null,
  server_first_seen_at timestamptz not null default now(),
  server_last_seen_at timestamptz not null default now(),
  ended_at timestamptz null,
  ended boolean not null default false,
  constraint activity_engagement_segments_active_ms_check check (active_ms >= 0),
  constraint activity_engagement_segments_client_unique unique (activity_id, user_id, client_segment_id)
);

create index if not exists activity_engagement_segments_activity_user_idx
  on public.activity_engagement_segments (activity_id, user_id);

create index if not exists activity_engagement_segments_activity_target_idx
  on public.activity_engagement_segments (activity_id, target_id);

comment on table public.activity_engagement_segments is
  'Point 5 active-time segments for assigned course activities. Absolute active_ms per client_segment_id. Aggregates derived, not stored.';

comment on column public.activity_engagement_segments.client_segment_id is
  'Client-generated unique segment id for idempotent absolute-total upserts.';

comment on column public.activity_engagement_segments.active_ms is
  'Absolute accumulated active milliseconds for this segment (never an additive delta command).';

comment on column public.activity_engagement_segments.target_id is
  'Frozen snapshot item id, lesson-doc:{lessonId}, or activity-ide:{activityId}.';

alter table public.activity_engagement_segments enable row level security;

-- ── Auth helpers (mirror Point 4 student-write / teacher-read boundary) ──────

create or replace function public.can_write_activity_engagement(p_activity_id uuid)
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

create or replace function public.can_read_activity_engagement(
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

revoke all on function public.can_write_activity_engagement(uuid) from public;
revoke all on function public.can_read_activity_engagement(uuid, uuid) from public;
grant execute on function public.can_write_activity_engagement(uuid) to authenticated;
grant execute on function public.can_read_activity_engagement(uuid, uuid) to authenticated;

drop policy if exists aes_select_own_or_teacher on public.activity_engagement_segments;
create policy aes_select_own_or_teacher on public.activity_engagement_segments
  for select to authenticated
  using (public.can_read_activity_engagement(activity_id, user_id));

-- No direct insert/update/delete for clients — writes go through RPC only.
drop policy if exists aes_insert_none on public.activity_engagement_segments;
drop policy if exists aes_update_none on public.activity_engagement_segments;
drop policy if exists aes_delete_none on public.activity_engagement_segments;

-- ── RPC: idempotent absolute-total upsert ───────────────────────────────────

create or replace function public.upsert_activity_engagement_segment(
  p_client_segment_id text,
  p_activity_id uuid,
  p_target_id text,
  p_target_type text,
  p_active_ms bigint,
  p_client_started_at timestamptz,
  p_ended boolean default false,
  p_unit_id text default null,
  p_lesson_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.activity_engagement_segments%rowtype;
  v_active bigint;
  v_elapsed_ms bigint;
  v_max_plausible bigint;
  v_tolerance_ms bigint := 15000;
  v_row public.activity_engagement_segments%rowtype;
  v_ended boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null
     or p_client_segment_id is null or trim(p_client_segment_id) = ''
     or p_target_id is null or trim(p_target_id) = ''
     or p_client_started_at is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;

  if p_active_ms is null or p_active_ms < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_active_ms');
  end if;

  -- Reject far-future client starts (clock skew tolerance)
  if p_client_started_at > (now() + make_interval(secs => (v_tolerance_ms / 1000.0))) then
    return jsonb_build_object('ok', false, 'error', 'invalid_client_started_at');
  end if;

  if not public.can_write_activity_engagement(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Plausible wall-clock cap for this segment (+ tolerance)
  v_elapsed_ms := greatest(
    0,
    floor(extract(epoch from (now() - p_client_started_at)) * 1000)
  )::bigint;
  v_max_plausible := v_elapsed_ms + v_tolerance_ms;
  v_active := least(p_active_ms, v_max_plausible);

  select * into v_existing
  from public.activity_engagement_segments
  where activity_id = p_activity_id
    and user_id = v_uid
    and client_segment_id = trim(p_client_segment_id);

  if found then
    -- Monotonic absolute total only; retries must not decrease or double-add
    if v_active < v_existing.active_ms then
      v_active := v_existing.active_ms;
    end if;
    v_ended := v_existing.ended or coalesce(p_ended, false);

    update public.activity_engagement_segments
    set
      target_id = trim(p_target_id),
      target_type = coalesce(nullif(trim(p_target_type), ''), v_existing.target_type, 'material'),
      unit_id = coalesce(p_unit_id, v_existing.unit_id),
      lesson_id = coalesce(p_lesson_id, v_existing.lesson_id),
      active_ms = v_active,
      server_last_seen_at = now(),
      ended = v_ended,
      ended_at = case
        when v_ended then coalesce(v_existing.ended_at, now())
        else v_existing.ended_at
      end
    where id = v_existing.id
    returning * into v_row;
  else
    v_ended := coalesce(p_ended, false);
    insert into public.activity_engagement_segments (
      client_segment_id, activity_id, user_id,
      target_id, target_type, unit_id, lesson_id,
      active_ms, client_started_at,
      server_first_seen_at, server_last_seen_at,
      ended, ended_at
    )
    values (
      trim(p_client_segment_id), p_activity_id, v_uid,
      trim(p_target_id),
      coalesce(nullif(trim(p_target_type), ''), 'material'),
      p_unit_id, p_lesson_id,
      v_active, p_client_started_at,
      now(), now(),
      v_ended,
      case when v_ended then now() else null end
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'row', jsonb_build_object(
      'id', v_row.id,
      'client_segment_id', v_row.client_segment_id,
      'activity_id', v_row.activity_id,
      'user_id', v_row.user_id,
      'target_id', v_row.target_id,
      'target_type', v_row.target_type,
      'unit_id', v_row.unit_id,
      'lesson_id', v_row.lesson_id,
      'active_ms', v_row.active_ms,
      'client_started_at', v_row.client_started_at,
      'server_first_seen_at', v_row.server_first_seen_at,
      'server_last_seen_at', v_row.server_last_seen_at,
      'ended', v_row.ended,
      'ended_at', v_row.ended_at
    )
  );
end;
$$;

revoke all on function public.upsert_activity_engagement_segment(
  text, uuid, text, text, bigint, timestamptz, boolean, text, text
) from public;
grant execute on function public.upsert_activity_engagement_segment(
  text, uuid, text, text, bigint, timestamptz, boolean, text, text
) to authenticated;

-- ── RPC: read engagement (self or course teacher / super admin) ─────────────

create or replace function public.get_activity_engagement_segments(
  p_activity_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;

  v_target := coalesce(p_user_id, v_uid);

  if not public.can_read_activity_engagement(p_activity_id, v_target) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Students may only read their own rows even if they pass another user id
  if v_target is distinct from v_uid
     and not exists (
       select 1 from public.activities a
       where a.id = p_activity_id
         and (public.is_course_teacher(a.course_id) or coalesce(public.is_super_admin(), false))
     ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.client_started_at), '[]'::jsonb)
  into v_rows
  from (
    select
      id, client_segment_id, activity_id, user_id,
      target_id, target_type, unit_id, lesson_id,
      active_ms, client_started_at,
      server_first_seen_at, server_last_seen_at,
      ended, ended_at
    from public.activity_engagement_segments
    where activity_id = p_activity_id
      and user_id = v_target
  ) t;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.get_activity_engagement_segments(uuid, uuid) from public;
grant execute on function public.get_activity_engagement_segments(uuid, uuid) to authenticated;
