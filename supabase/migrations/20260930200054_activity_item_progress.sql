-- Point 4: measurable per-student progress for assigned Content items.
-- Additive only. Does not alter activity_progress (IDE/autosave) or submissions/grades.
-- Progress is scoped by activity (assignment) + user + snapshot_item_id.

create table if not exists public.activity_item_progress (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_item_id text not null,
  source_item_id uuid null,
  item_type text not null,
  status text not null default 'not_started',
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint activity_item_progress_status_check check (
    status in ('not_started', 'in_progress', 'completed')
  ),
  constraint activity_item_progress_unique unique (activity_id, user_id, snapshot_item_id)
);

create index if not exists activity_item_progress_activity_user_idx
  on public.activity_item_progress (activity_id, user_id);

create index if not exists activity_item_progress_activity_idx
  on public.activity_item_progress (activity_id);

comment on table public.activity_item_progress is
  'Pedagogical item progress for frozen assignment snapshots. Keyed by activity + student + snapshot_item_id. Aggregates are derived, not stored.';

comment on column public.activity_item_progress.source_item_id is
  'Optional live content_items.id for audit/remap only. Progress is never keyed solely by live content_items.id.';

comment on column public.activity_item_progress.metadata is
  'Minimal Point-4 metadata only (e.g. video threshold hit). No grades/scores/rubric/active_ms.';

alter table public.activity_item_progress enable row level security;

-- ── Helpers (security definer; avoid RLS recursion) ─────────────────────────

create or replace function public.can_write_activity_item_progress(p_activity_id uuid)
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

create or replace function public.can_read_activity_item_progress(
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

revoke all on function public.can_write_activity_item_progress(uuid) from public;
revoke all on function public.can_read_activity_item_progress(uuid, uuid) from public;
grant execute on function public.can_write_activity_item_progress(uuid) to authenticated;
grant execute on function public.can_read_activity_item_progress(uuid, uuid) to authenticated;

-- Student: own rows only, for assigned/visible activity while course student
drop policy if exists aip_select_own_or_teacher on public.activity_item_progress;
create policy aip_select_own_or_teacher on public.activity_item_progress
  for select to authenticated
  using (public.can_read_activity_item_progress(activity_id, user_id));

drop policy if exists aip_insert_own_student on public.activity_item_progress;
create policy aip_insert_own_student on public.activity_item_progress
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_write_activity_item_progress(activity_id)
  );

drop policy if exists aip_update_own_student on public.activity_item_progress;
create policy aip_update_own_student on public.activity_item_progress
  for update to authenticated
  using (
    user_id = auth.uid()
    and public.can_write_activity_item_progress(activity_id)
  )
  with check (
    user_id = auth.uid()
    and public.can_write_activity_item_progress(activity_id)
  );

-- No delete policy for students (retain history). Teachers do not write progress.

-- ── RPC: upsert (forward-only status machine) ───────────────────────────────

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

  select * into v_existing
  from public.activity_item_progress
  where activity_id = p_activity_id
    and user_id = v_uid
    and snapshot_item_id = p_snapshot_item_id;

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
    p_activity_id, v_uid, p_snapshot_item_id, p_source_item_id,
    coalesce(nullif(trim(p_item_type), ''), 'material'),
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

-- ── RPC: get progress for activity (self or teacher for a student) ──────────

create or replace function public.get_activity_item_progress(
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

  if not public.can_read_activity_item_progress(p_activity_id, v_target) then
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

  select coalesce(jsonb_agg(row_to_json(t) order by t.updated_at), '[]'::jsonb)
  into v_rows
  from (
    select
      id, activity_id, user_id, snapshot_item_id, source_item_id,
      item_type, status, started_at, completed_at, updated_at, metadata
    from public.activity_item_progress
    where activity_id = p_activity_id
      and user_id = v_target
  ) t;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function public.get_activity_item_progress(uuid, uuid) to authenticated;

-- ── RPC: teacher course content-progress overview ───────────────────────────

create or replace function public.get_course_content_progress_overview(p_course_id uuid)
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
      a.content_snapshot
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

  return jsonb_build_object(
    'ok', true,
    'course_id', p_course_id,
    'activities', coalesce(v_activities, '[]'::jsonb),
    'students', coalesce(v_students, '[]'::jsonb),
    'progress', coalesce(v_progress, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_course_content_progress_overview(uuid) to authenticated;
