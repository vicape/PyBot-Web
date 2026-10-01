-- Point 5 repair: harden upsert_activity_engagement_segment.
-- Forward-only. Does not alter historical migration, drop data, or broaden RLS.
-- - Immutable segment identity after first insert
-- - Existing-row plausibility uses stored client_started_at
-- - Ended segments cannot grow active_ms (higher active_ms after ended=true is rejected)
-- - Concurrent absolute writes remain monotonic (SELECT FOR UPDATE + GREATEST)
-- - auth.uid() remains the only server-side write identity
-- - Inactivity boundary for client accounting remains exactly 90,000 ms

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
  v_target_id text;
  v_target_type text;
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

  -- Reject far-future client starts (clock skew tolerance) — insert path only uses this stamp
  if p_client_started_at > (now() + make_interval(secs => (v_tolerance_ms / 1000.0))) then
    return jsonb_build_object('ok', false, 'error', 'invalid_client_started_at');
  end if;

  if not public.can_write_activity_engagement(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_target_id := trim(p_target_id);
  v_target_type := coalesce(nullif(trim(p_target_type), ''), 'material');

  -- Serialize concurrent writers for the same segment identity
  select * into v_existing
  from public.activity_engagement_segments
  where activity_id = p_activity_id
    and user_id = v_uid
    and client_segment_id = trim(p_client_segment_id)
  for update;

  if found then
    -- Immutable identity: reject conflicting retries (fail closed, do not rewrite)
    if v_existing.target_id is distinct from v_target_id
       or v_existing.target_type is distinct from v_target_type
       or v_existing.unit_id is distinct from p_unit_id
       or v_existing.lesson_id is distinct from p_lesson_id
       or v_existing.client_started_at is distinct from p_client_started_at
       or v_existing.activity_id is distinct from p_activity_id
       or v_existing.user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'identity_mismatch');
    end if;

    -- Plausibility uses ALREADY-STORED start time (client cannot move start on retry)
    v_elapsed_ms := greatest(
      0,
      floor(extract(epoch from (now() - v_existing.client_started_at)) * 1000)
    )::bigint;
    v_max_plausible := v_elapsed_ms + v_tolerance_ms;
    v_active := least(p_active_ms, v_max_plausible);

    if v_existing.ended then
      -- ended=true: segment cannot grow; identical/lower idempotent retry keeps stored total
      v_active := v_existing.active_ms;
      v_ended := true;
    else
      -- Monotonic absolute total under concurrency / out-of-order writes
      v_active := greatest(v_existing.active_ms, v_active);
      v_ended := coalesce(p_ended, false);
    end if;

    update public.activity_engagement_segments
    set
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
    -- Insert path: plausibility from supplied start
    v_elapsed_ms := greatest(
      0,
      floor(extract(epoch from (now() - p_client_started_at)) * 1000)
    )::bigint;
    v_max_plausible := v_elapsed_ms + v_tolerance_ms;
    v_active := least(p_active_ms, v_max_plausible);
    v_ended := coalesce(p_ended, false);

    begin
      insert into public.activity_engagement_segments (
        client_segment_id, activity_id, user_id,
        target_id, target_type, unit_id, lesson_id,
        active_ms, client_started_at,
        server_first_seen_at, server_last_seen_at,
        ended, ended_at
      )
      values (
        trim(p_client_segment_id), p_activity_id, v_uid,
        v_target_id,
        v_target_type,
        p_unit_id, p_lesson_id,
        v_active, p_client_started_at,
        now(), now(),
        v_ended,
        case when v_ended then now() else null end
      )
      returning * into v_row;
    exception
      when unique_violation then
        -- Concurrent insert won: re-enter update path atomically
        return public.upsert_activity_engagement_segment(
          p_client_segment_id,
          p_activity_id,
          p_target_id,
          p_target_type,
          p_active_ms,
          p_client_started_at,
          p_ended,
          p_unit_id,
          p_lesson_id
        );
    end;
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

comment on function public.upsert_activity_engagement_segment(
  text, uuid, text, text, bigint, timestamptz, boolean, text, text
) is
  'Point 5 absolute-total upsert. Immutable segment identity; stored start for plausibility; ended cannot grow; monotonic under concurrency. auth.uid() only.';
