-- ──────────────────────────────────────────────────────────────────────────
-- Migración 017 — Persistir y listar roster pendiente (fix UI vacía).
-- IDEMPOTENTE. Completa 016 si faltaba aplicar o si el sync no guardó pending.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.course_roster_pending (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  classroom_user_id text not null,
  email text not null,
  display_name text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (course_id, classroom_user_id)
);

create index if not exists course_roster_pending_course_id_idx
  on public.course_roster_pending (course_id);

create index if not exists course_roster_pending_email_idx
  on public.course_roster_pending (lower(email));

alter table public.course_roster_pending enable row level security;

drop policy if exists crp_select_staff on public.course_roster_pending;
create policy crp_select_staff on public.course_roster_pending
  for select using (public.is_course_org_staff(course_id));

drop policy if exists crp_insert_staff on public.course_roster_pending;
create policy crp_insert_staff on public.course_roster_pending
  for insert to authenticated
  with check (public.is_course_org_staff(course_id));

drop policy if exists crp_update_staff on public.course_roster_pending;
create policy crp_update_staff on public.course_roster_pending
  for update to authenticated
  using (public.is_course_org_staff(course_id))
  with check (public.is_course_org_staff(course_id));

drop policy if exists crp_delete_staff on public.course_roster_pending;
create policy crp_delete_staff on public.course_roster_pending
  for delete using (public.is_course_org_staff(course_id));

create or replace function public.list_course_roster_pending(p_course_id uuid)
returns table (
  id uuid,
  classroom_user_id text,
  email text,
  display_name text,
  synced_at timestamptz
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
  if not public.is_course_org_staff(p_course_id) then
    return;
  end if;

  return query
  select p.id, p.classroom_user_id, p.email, p.display_name, p.synced_at
  from public.course_roster_pending p
  where p.course_id = p_course_id
  order by coalesce(p.display_name, p.email);
end;
$$;

grant execute on function public.list_course_roster_pending(uuid) to authenticated;

-- Reemplaza el set de pendientes del curso (idempotente)
create or replace function public.replace_course_roster_pending(
  p_course_id uuid,
  p_org_id uuid,
  p_pending jsonb,
  p_active_classroom_user_ids text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_classroom_user_id text;
  v_email text;
  v_display_name text;
  v_upserted int := 0;
  v_removed int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if not public.is_course_org_staff(p_course_id) then
    return jsonb_build_object('ok', false, 'error', 'sin_permisos');
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.org_id = p_org_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'curso_invalido');
  end if;

  if p_pending is not null and jsonb_typeof(p_pending) = 'array' then
    for v_item in select value from jsonb_array_elements(p_pending)
    loop
      v_classroom_user_id := nullif(trim(v_item->>'classroom_user_id'), '');
      v_email := lower(trim(coalesce(v_item->>'email', '')));
      v_display_name := nullif(trim(v_item->>'display_name'), '');

      if v_classroom_user_id is null or v_email = '' then
        continue;
      end if;

      insert into public.course_roster_pending (
        course_id, org_id, classroom_user_id, email, display_name, synced_at
      )
      values (
        p_course_id, p_org_id, v_classroom_user_id, v_email, v_display_name, now()
      )
      on conflict (course_id, classroom_user_id) do update
      set
        email = excluded.email,
        display_name = coalesce(excluded.display_name, course_roster_pending.display_name),
        org_id = excluded.org_id,
        synced_at = excluded.synced_at;

      v_upserted := v_upserted + 1;
    end loop;
  end if;

  if p_active_classroom_user_ids is not null then
    delete from public.course_roster_pending p
    where p.course_id = p_course_id
      and not (p.classroom_user_id = any (p_active_classroom_user_ids));
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'removed', v_removed
  );
end;
$$;

grant execute on function public.replace_course_roster_pending(uuid, uuid, jsonb, text[]) to authenticated;

-- claim (por si 016 no se aplicó)
create or replace function public.claim_pending_course_rosters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  r record;
  v_claimed int := 0;
  v_courses uuid[] := array[]::uuid[];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select lower(trim(email)) into v_email
  from public.profiles
  where id = v_uid;

  if v_email is null or v_email = '' then
    select lower(trim(email)) into v_email from auth.users where id = v_uid;
  end if;

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', true, 'claimed', 0, 'course_ids', '[]'::jsonb);
  end if;

  for r in
    select p.*
    from public.course_roster_pending p
    where lower(trim(p.email)) = v_email
  loop
    if not exists (
      select 1 from public.organization_members om
      where om.org_id = r.org_id and om.user_id = v_uid
    ) then
      insert into public.organization_members (org_id, user_id, role)
      values (r.org_id, v_uid, 'student');
    end if;

    insert into public.course_members (
      course_id, user_id, role, source, classroom_user_id, classroom_email, synced_at
    )
    values (
      r.course_id, v_uid, 'student', 'classroom',
      r.classroom_user_id, r.email, now()
    )
    on conflict (course_id, user_id) do update
    set
      source = excluded.source,
      classroom_user_id = coalesce(excluded.classroom_user_id, course_members.classroom_user_id),
      classroom_email = coalesce(excluded.classroom_email, course_members.classroom_email),
      synced_at = excluded.synced_at;

    delete from public.course_roster_pending where id = r.id;
    v_claimed := v_claimed + 1;
    v_courses := array_append(v_courses, r.course_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'claimed', v_claimed,
    'course_ids', to_jsonb(v_courses)
  );
end;
$$;

grant execute on function public.claim_pending_course_rosters() to authenticated;
