-- Migración 041 — Cache persistente de StudentSubmissions de Google Classroom
-- IDEMPOTENTE. No reemplaza activity_submissions (entregas PyBot).

create table if not exists public.activity_classroom_submissions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid null references auth.users (id) on delete set null,
  classroom_user_id text not null,
  classroom_submission_id text not null,
  classroom_coursework_id text not null,
  classroom_submission_state text null,
  classroom_late boolean not null default false,
  classroom_draft_grade numeric null,
  classroom_assigned_grade numeric null,
  classroom_submission_created_at timestamptz null,
  classroom_submission_updated_at timestamptz null,
  classroom_last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, classroom_user_id)
);

create index if not exists activity_classroom_submissions_activity_id_idx
  on public.activity_classroom_submissions (activity_id);

create index if not exists activity_classroom_submissions_user_id_idx
  on public.activity_classroom_submissions (user_id);

create index if not exists activity_classroom_submissions_classroom_submission_id_idx
  on public.activity_classroom_submissions (classroom_submission_id);

alter table public.activity_classroom_submissions enable row level security;

-- Docente/co-docente: ver mappings del curso
drop policy if exists acs_select_teacher on public.activity_classroom_submissions;
create policy acs_select_teacher on public.activity_classroom_submissions
  for select using (
    exists (
      select 1
      from public.activities a
      where a.id = activity_classroom_submissions.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

-- Alumno: solo su propia fila (si está vinculada)
drop policy if exists acs_select_own on public.activity_classroom_submissions;
create policy acs_select_own on public.activity_classroom_submissions
  for select using (user_id = auth.uid());

-- SuperAdmin
drop policy if exists acs_super_admin_all on public.activity_classroom_submissions;
create policy acs_super_admin_all on public.activity_classroom_submissions
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- Sin políticas INSERT/UPDATE/DELETE genéricas para authenticated:
-- la escritura va solo por RPC SECURITY DEFINER.

create or replace function public.sync_activity_classroom_submissions(
  p_activity_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_coursework_id text;
  v_now timestamptz := now();
  v_elem jsonb;
  v_classroom_user_id text;
  v_classroom_submission_id text;
  v_classroom_coursework_id text;
  v_state text;
  v_late boolean;
  v_draft numeric;
  v_assigned numeric;
  v_created timestamptz;
  v_updated timestamptz;
  v_user_id uuid;
  v_persisted int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_activity_id');
  end if;

  select a.course_id, a.classroom_coursework_id
    into v_course_id, v_coursework_id
  from public.activities a
  where a.id = p_activity_id;

  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;

  if not public.is_course_teacher(v_course_id)
     and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_rows');
  end if;

  for v_elem in select * from jsonb_array_elements(p_rows)
  loop
    v_classroom_user_id := nullif(trim(coalesce(v_elem->>'userId', v_elem->>'classroom_user_id', '')), '');
    v_classroom_submission_id := nullif(
      trim(coalesce(v_elem->>'id', v_elem->>'classroom_submission_id', '')),
      ''
    );
    v_classroom_coursework_id := nullif(
      trim(coalesce(
        v_elem->>'courseWorkId',
        v_elem->>'classroom_coursework_id',
        v_coursework_id,
        ''
      )),
      ''
    );

    if v_classroom_user_id is null or v_classroom_submission_id is null or v_classroom_coursework_id is null then
      continue;
    end if;

    v_state := nullif(trim(coalesce(v_elem->>'state', v_elem->>'classroom_submission_state', '')), '');
    v_late := coalesce((v_elem->>'late')::boolean, (v_elem->>'classroom_late')::boolean, false);

    begin
      v_draft := nullif(v_elem->>'draftGrade', '')::numeric;
    exception when others then
      v_draft := null;
    end;
    if v_draft is null then
      begin
        v_draft := nullif(v_elem->>'classroom_draft_grade', '')::numeric;
      exception when others then
        v_draft := null;
      end;
    end if;

    begin
      v_assigned := nullif(v_elem->>'assignedGrade', '')::numeric;
    exception when others then
      v_assigned := null;
    end;
    if v_assigned is null then
      begin
        v_assigned := nullif(v_elem->>'classroom_assigned_grade', '')::numeric;
      exception when others then
        v_assigned := null;
      end;
    end if;

    begin
      v_created := nullif(v_elem->>'creationTime', '')::timestamptz;
    exception when others then
      v_created := null;
    end;
    if v_created is null then
      begin
        v_created := nullif(v_elem->>'classroom_submission_created_at', '')::timestamptz;
      exception when others then
        v_created := null;
      end;
    end if;

    begin
      v_updated := nullif(v_elem->>'updateTime', '')::timestamptz;
    exception when others then
      v_updated := null;
    end;
    if v_updated is null then
      begin
        v_updated := nullif(v_elem->>'classroom_submission_updated_at', '')::timestamptz;
      exception when others then
        v_updated := null;
      end;
    end if;

    select cm.user_id into v_user_id
    from public.course_members cm
    where cm.course_id = v_course_id
      and cm.classroom_user_id = v_classroom_user_id
    limit 1;

    insert into public.activity_classroom_submissions (
      activity_id,
      user_id,
      classroom_user_id,
      classroom_submission_id,
      classroom_coursework_id,
      classroom_submission_state,
      classroom_late,
      classroom_draft_grade,
      classroom_assigned_grade,
      classroom_submission_created_at,
      classroom_submission_updated_at,
      classroom_last_synced_at,
      updated_at
    ) values (
      p_activity_id,
      v_user_id,
      v_classroom_user_id,
      v_classroom_submission_id,
      v_classroom_coursework_id,
      v_state,
      v_late,
      v_draft,
      v_assigned,
      v_created,
      v_updated,
      v_now,
      v_now
    )
    on conflict (activity_id, classroom_user_id) do update set
      user_id = coalesce(excluded.user_id, activity_classroom_submissions.user_id),
      classroom_submission_id = excluded.classroom_submission_id,
      classroom_coursework_id = excluded.classroom_coursework_id,
      classroom_submission_state = excluded.classroom_submission_state,
      classroom_late = excluded.classroom_late,
      classroom_draft_grade = excluded.classroom_draft_grade,
      classroom_assigned_grade = excluded.classroom_assigned_grade,
      classroom_submission_created_at = excluded.classroom_submission_created_at,
      classroom_submission_updated_at = excluded.classroom_submission_updated_at,
      classroom_last_synced_at = excluded.classroom_last_synced_at,
      updated_at = excluded.updated_at;

    -- Compat: completar activity_submissions.classroom_submission_id si es NULL
    if v_user_id is not null then
      update public.activity_submissions s
      set
        classroom_submission_id = v_classroom_submission_id,
        updated_at = v_now
      where s.activity_id = p_activity_id
        and s.user_id = v_user_id
        and (s.classroom_submission_id is null or s.classroom_submission_id = '');
    end if;

    v_persisted := v_persisted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'persisted', v_persisted,
    'syncedAt', v_now
  );
end;
$$;

grant execute on function public.sync_activity_classroom_submissions(uuid, jsonb) to authenticated;
