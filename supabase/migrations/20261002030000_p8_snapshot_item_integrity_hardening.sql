-- Point 8: snapshot-item integrity hardening for P4/P7.
-- Baseline confirmado exactamente f1b66c09f02cf3b4200062ad8e6aa2e19fbc45d5
-- content_snapshot is the source of truth for snapshot_item_id, item_type,
-- sourceItemId, config and completion identity. Never trust client alone.
-- Forward-only. Do NOT modify 20261002000060_course_learning_status_overview.sql
-- nor 20261002014500_p7_embedded_item_evidence_and_media.sql.
-- File exactly: supabase/migrations/20261002030000_p8_snapshot_item_integrity_hardening.sql
-- DO NOT apply from Cloud Cursor; MaxBase applies this exact file.
--
-- AC5/AC6 contract: submit_activity_item carga activities.content_snapshot por p_activity_id,
-- localiza el ítem exacto dentro del snapshot congelado, soporta sourceType exactamente
-- lesson, unit y content, y busca por snapshotItemId.
-- Si el ítem no existe en el snapshot, submit_activity_item devuelve ok:false
-- con error estable exactamente snapshot_item_not_found.

-- ── Helper: locate frozen item inside activities.content_snapshot ─────────────

create or replace function public.find_activity_snapshot_item(
  p_snapshot jsonb,
  p_snapshot_item_id text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_id text := trim(coalesce(p_snapshot_item_id, ''));
  v_source text;
  v_item jsonb;
  v_lesson jsonb;
  v_unit jsonb;
begin
  if p_snapshot is null or v_id = '' then
    return null;
  end if;

  v_source := coalesce(p_snapshot->>'sourceType', '');

  if v_source = 'lesson' then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_snapshot->'items', '[]'::jsonb))
    loop
      if coalesce(nullif(trim(v_item->>'snapshotItemId'), ''), nullif(trim(v_item->>'id'), '')) = v_id then
        return v_item;
      end if;
    end loop;
    return null;
  end if;

  if v_source = 'unit' then
    for v_lesson in
      select value
      from jsonb_array_elements(coalesce(p_snapshot->'lessons', '[]'::jsonb))
    loop
      for v_item in
        select value
        from jsonb_array_elements(coalesce(v_lesson->'items', '[]'::jsonb))
      loop
        if coalesce(nullif(trim(v_item->>'snapshotItemId'), ''), nullif(trim(v_item->>'id'), '')) = v_id then
          return v_item;
        end if;
      end loop;
    end loop;
    return null;
  end if;

  if v_source = 'content' then
    for v_unit in
      select value
      from jsonb_array_elements(coalesce(p_snapshot->'units', '[]'::jsonb))
    loop
      for v_lesson in
        select value
        from jsonb_array_elements(coalesce(v_unit->'lessons', '[]'::jsonb))
      loop
        for v_item in
          select value
          from jsonb_array_elements(coalesce(v_lesson->'items', '[]'::jsonb))
        loop
          if coalesce(nullif(trim(v_item->>'snapshotItemId'), ''), nullif(trim(v_item->>'id'), '')) = v_id then
            return v_item;
          end if;
        end loop;
      end loop;
    end loop;
    return null;
  end if;

  return null;
end;
$$;

revoke all on function public.find_activity_snapshot_item(jsonb, text) from public;
grant execute on function public.find_activity_snapshot_item(jsonb, text) to authenticated;

-- ── Close student direct INSERT/UPDATE bypass on activity_item_progress ──────
-- Writes must go through upsert_activity_item_progress (security definer).
-- SELECT RLS for student/teacher remains unchanged. Existing P4 rows preserved.

drop policy if exists aip_insert_own_student on public.activity_item_progress;
drop policy if exists aip_update_own_student on public.activity_item_progress;

-- ── Harden upsert_activity_item_progress (P4) ────────────────────────────────

create or replace function public.upsert_activity_item_progress(
  p_activity_id uuid,
  p_snapshot_item_id text,
  p_item_type text,
  p_status text,
  p_source_item_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.activity_item_progress%rowtype;
  v_status text;
  v_started timestamptz;
  v_completed timestamptz;
  v_rank_existing int;
  v_rank_new int;
  v_row public.activity_item_progress%rowtype;
  v_snapshot jsonb;
  v_item jsonb;
  v_item_type text;
  v_source_item_id uuid;
  v_client_type text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_activity_id is null or p_snapshot_item_id is null or trim(p_snapshot_item_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;
  if p_status is null or p_status not in ('not_started', 'in_progress', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  if not public.can_write_activity_item_progress(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select a.content_snapshot into v_snapshot
  from public.activities a
  where a.id = p_activity_id;

  v_item := public.find_activity_snapshot_item(v_snapshot, trim(p_snapshot_item_id));
  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'snapshot_item_not_found');
  end if;

  v_item_type := coalesce(nullif(trim(v_item->>'type'), ''), 'material');
  v_client_type := nullif(trim(coalesce(p_item_type, '')), '');
  if v_client_type is not null and v_client_type is distinct from v_item_type then
    return jsonb_build_object('ok', false, 'error', 'item_type_mismatch');
  end if;

  v_source_item_id := null;
  if (v_item->>'sourceItemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_source_item_id := (v_item->>'sourceItemId')::uuid;
  end if;
  -- Client cannot override identity fields derived from frozen snapshot.
  -- p_source_item_id is ignored when snapshot provides sourceItemId; otherwise ignored entirely.

  select * into v_existing
  from public.activity_item_progress
  where activity_id = p_activity_id
    and user_id = v_uid
    and snapshot_item_id = trim(p_snapshot_item_id);

  v_rank_new := case p_status
    when 'not_started' then 0
    when 'in_progress' then 1
    when 'completed' then 2
    else 0
  end;

  if found then
    v_rank_existing := case v_existing.status
      when 'not_started' then 0
      when 'in_progress' then 1
      when 'completed' then 2
      else 0
    end;
    if v_rank_new < v_rank_existing then
      v_status := v_existing.status;
    else
      v_status := p_status;
    end if;
    v_started := v_existing.started_at;
    v_completed := v_existing.completed_at;
  else
    v_status := p_status;
    v_started := null;
    v_completed := null;
  end if;

  if v_status in ('in_progress', 'completed') and v_started is null then
    v_started := now();
  end if;
  if v_status = 'completed' and v_completed is null then
    v_completed := now();
  end if;

  insert into public.activity_item_progress (
    activity_id, user_id, snapshot_item_id, source_item_id, item_type,
    status, started_at, completed_at, updated_at, metadata
  )
  values (
    p_activity_id, v_uid, trim(p_snapshot_item_id), v_source_item_id,
    v_item_type,
    v_status, v_started, v_completed, now(),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (activity_id, user_id, snapshot_item_id) do update
  set
    item_type = excluded.item_type,
    source_item_id = coalesce(excluded.source_item_id, public.activity_item_progress.source_item_id),
    status = excluded.status,
    started_at = coalesce(public.activity_item_progress.started_at, excluded.started_at),
    completed_at = case
      when excluded.status = 'completed'
        then coalesce(public.activity_item_progress.completed_at, excluded.completed_at)
      else public.activity_item_progress.completed_at
    end,
    updated_at = now(),
    metadata = case
      when excluded.metadata = '{}'::jsonb then public.activity_item_progress.metadata
      else excluded.metadata
    end
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'row', jsonb_build_object(
      'id', v_row.id,
      'activity_id', v_row.activity_id,
      'user_id', v_row.user_id,
      'snapshot_item_id', v_row.snapshot_item_id,
      'source_item_id', v_row.source_item_id,
      'item_type', v_row.item_type,
      'status', v_row.status,
      'started_at', v_row.started_at,
      'completed_at', v_row.completed_at,
      'updated_at', v_row.updated_at,
      'metadata', v_row.metadata
    )
  );
end;
$$;

grant execute on function public.upsert_activity_item_progress(uuid, text, text, text, uuid, jsonb) to authenticated;

-- ── Harden submit_activity_item (P7) ─────────────────────────────────────────

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
  v_snapshot jsonb;
  v_item jsonb;
  v_item_type text;
  v_client_type text;
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

  select a.content_snapshot into v_snapshot
  from public.activities a
  where a.id = p_activity_id;

  -- Locate exact frozen item; support sourceType lesson | unit | content.
  -- Do NOT consult live content_items for identity/type.
  v_item := public.find_activity_snapshot_item(v_snapshot, trim(p_snapshot_item_id));
  if v_item is null then
    return jsonb_build_object('ok', false, 'error', 'snapshot_item_not_found');
  end if;

  v_item_type := coalesce(nullif(trim(v_item->>'type'), ''), 'material');
  v_client_type := nullif(trim(coalesce(p_item_type, '')), '');
  if v_client_type is not null and v_client_type is distinct from v_item_type then
    return jsonb_build_object('ok', false, 'error', 'item_type_mismatch');
  end if;

  if v_item_type not in ('exercise', 'quiz', 'assignment', 'assessment') then
    return jsonb_build_object('ok', false, 'error', 'item_type_not_allowed');
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
    v_item_type,
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

-- ── Align grade_activity_item_submission with grade_activity_submission ──────

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

  -- earned_points != null requires possible_points != null
  if p_earned_points is not null and p_possible_points is null then
    return jsonb_build_object('ok', false, 'error', 'possible_points_required');
  end if;

  if p_earned_points is not null then
    if p_earned_points < 0 or not (p_earned_points = p_earned_points) then
      return jsonb_build_object('ok', false, 'error', 'invalid_earned_points');
    end if;
  end if;

  if p_possible_points is not null then
    if p_possible_points <= 0 or not (p_possible_points = p_possible_points) then
      return jsonb_build_object('ok', false, 'error', 'invalid_possible_points');
    end if;
  end if;

  if p_earned_points is not null
     and p_possible_points is not null
     and p_earned_points > p_possible_points then
    return jsonb_build_object('ok', false, 'error', 'earned_exceeds_possible');
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

-- ── Compatible points coherence constraint (skip if legacy violations) ───────

do $$
begin
  if exists (
    select 1
    from public.activity_item_submissions
    where earned_points is not null
      and (
        possible_points is null
        or possible_points <= 0
        or earned_points < 0
        or earned_points > possible_points
        or earned_points <> earned_points
        or possible_points <> possible_points
      )
  ) then
    raise notice 'P8: skip activity_item_submissions_points_coherent (incompatible existing rows)';
  else
    alter table public.activity_item_submissions
      drop constraint if exists activity_item_submissions_points_coherent;
    alter table public.activity_item_submissions
      add constraint activity_item_submissions_points_coherent
      check (
        earned_points is null
        or (
          possible_points is not null
          and possible_points > 0
          and earned_points >= 0
          and earned_points <= possible_points
        )
      );
  end if;
end;
$$;
