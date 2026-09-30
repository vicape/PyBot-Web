-- Person-centered model: personal courses (nullable org_id), contextual course
-- authority via course_members, optional institutions, forward-compatible
-- multi-role institution membership without destructive reset.
-- IDEMPOTENT. Does not edit historical migrations.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) Personal courses: org_id may be null (no fake institution)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.courses
  alter column org_id drop not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Forward-compatible multi-role org membership (additive; keep primary row)
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.organization_member_roles (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'teacher', 'student')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, role)
);

create index if not exists organization_member_roles_user_id_idx
  on public.organization_member_roles (user_id);

create index if not exists organization_member_roles_org_id_idx
  on public.organization_member_roles (org_id);

alter table public.organization_member_roles enable row level security;

-- Backfill existing memberships (non-destructive; runs as migration role)
insert into public.organization_member_roles (org_id, user_id, role, created_at)
select om.org_id, om.user_id, om.role, coalesce(om.created_at, now())
from public.organization_members om
on conflict (org_id, user_id, role) do nothing;

-- Staff helper: null org never grants; check primary + additive roles
create or replace function public.is_org_staff(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_org_id is not null
    and (
      exists (
        select 1
        from public.organization_members om
        where om.org_id = p_org_id
          and om.user_id = auth.uid()
          and om.role in ('owner', 'teacher')
      )
      or exists (
        select 1
        from public.organization_member_roles omr
        where omr.org_id = p_org_id
          and omr.user_id = auth.uid()
          and omr.role in ('owner', 'teacher')
      )
    );
$$;

grant execute on function public.is_org_staff(uuid) to authenticated;

drop policy if exists omr_select_self on public.organization_member_roles;
create policy omr_select_self on public.organization_member_roles
  for select using (user_id = auth.uid());

drop policy if exists omr_staff_manage on public.organization_member_roles;
create policy omr_staff_manage on public.organization_member_roles
  for all to authenticated
  using (public.is_org_staff(org_id))
  with check (public.is_org_staff(org_id));

create or replace function public.is_course_org_staff(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.org_id is not null
      and public.is_org_staff(c.org_id)
  );
$$;

grant execute on function public.is_course_org_staff(uuid) to authenticated;

-- List memberships as one row per (org, role) including additive roles
create or replace function public.list_my_org_memberships()
returns table (org_id uuid, role text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select x.org_id, x.role, min(x.created_at) as created_at
  from (
    select om.org_id, om.role, om.created_at
    from public.organization_members om
    where om.user_id = auth.uid()
    union all
    select omr.org_id, omr.role, omr.created_at
    from public.organization_member_roles omr
    where omr.user_id = auth.uid()
  ) x
  group by x.org_id, x.role
  order by min(x.created_at), x.org_id,
    case x.role when 'owner' then 1 when 'teacher' then 2 when 'student' then 3 else 4 end;
$$;

grant execute on function public.list_my_org_memberships() to authenticated;

-- Preserve prior role in additive table when upgrading primary membership
create or replace function public.ensure_org_teacher_access(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_org');
  end if;

  select role into v_role
  from public.organization_members
  where org_id = p_org_id and user_id = v_uid;

  if v_role is not null then
    insert into public.organization_member_roles (org_id, user_id, role)
    values (p_org_id, v_uid, v_role)
    on conflict (org_id, user_id, role) do nothing;
  end if;

  if v_role = 'owner' or v_role = 'teacher' then
    insert into public.organization_member_roles (org_id, user_id, role)
    values (p_org_id, v_uid, v_role)
    on conflict (org_id, user_id, role) do nothing;
    return jsonb_build_object('ok', true, 'role', v_role);
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (p_org_id, v_uid, 'teacher')
  on conflict (org_id, user_id) do update
    set role = case
      when public.organization_members.role = 'owner' then 'owner'
      else 'teacher'
    end;

  insert into public.organization_member_roles (org_id, user_id, role)
  values (p_org_id, v_uid, 'teacher')
  on conflict (org_id, user_id, role) do nothing;

  return jsonb_build_object('ok', true, 'role', 'teacher');
end;
$$;

grant execute on function public.ensure_org_teacher_access(uuid) to authenticated;

-- Owner/staff may grant an additional existing role without dropping others
create or replace function public.add_organization_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if p_org_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;
  if p_role not in ('owner', 'teacher', 'student') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  if not public.is_org_staff(p_org_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;

  insert into public.organization_member_roles (org_id, user_id, role)
  values (p_org_id, p_user_id, p_role)
  on conflict (org_id, user_id, role) do nothing;

  return jsonb_build_object('ok', true, 'org_id', p_org_id, 'user_id', p_user_id, 'role', p_role);
end;
$$;

grant execute on function public.add_organization_member_role(uuid, uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Course insert: personal (org_id null) OR institutional staff
-- ──────────────────────────────────────────────────────────────────────────

drop policy if exists courses_insert_staff on public.courses;
create policy courses_insert_staff on public.courses
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (
        org_id is null
      )
      or (
        org_id is not null
        and public.is_org_staff(org_id)
      )
    )
  );

-- Creator/teacher membership is authoritative for personal courses
drop policy if exists courses_select_member on public.courses;
create policy courses_select_member on public.courses
  for select using (
    (org_id is not null and public.is_org_staff(org_id))
    or public.is_course_teacher(id)
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = courses.id
        and cm.user_id = auth.uid()
    )
    or created_by = auth.uid()
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4) RPC: create personal course + factual course teacher membership
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.create_personal_course(
  p_title text,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_slug text := nullif(trim(coalesce(p_slug, '')), '');
  v_course_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_title');
  end if;

  if v_slug is null then
    v_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'course';
    end if;
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  insert into public.courses (org_id, title, slug, created_by)
  values (null, v_title, v_slug, v_uid)
  returning id into v_course_id;

  insert into public.course_members (course_id, user_id, role, source)
  values (v_course_id, v_uid, 'teacher', 'manual')
  on conflict (course_id, user_id) do update
    set role = 'teacher';

  return jsonb_build_object(
    'ok', true,
    'course_id', v_course_id,
    'org_id', null,
    'title', v_title,
    'slug', v_slug
  );
end;
$$;

revoke all on function public.create_personal_course(text, text) from public;
grant execute on function public.create_personal_course(text, text) to authenticated;

comment on function public.create_personal_course(text, text) is
  'Create a personal course (org_id null) and grant creator course_members.teacher. Independent of organization membership and presentation preferences.';

-- ──────────────────────────────────────────────────────────────────────────
-- 5) List courses: include personal (left join organizations)
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.list_pybotclass_my_courses(p_org_id uuid default null)
returns table (
  course_id uuid,
  course_title text,
  org_id uuid,
  org_name text,
  classroom_course_id text,
  my_course_role text,
  student_count bigint,
  activity_count bigint,
  submission_count bigint,
  pending_grade_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  with visible as (
    select c.id as course_id, coalesce(om.role, 'teacher') as my_course_role
    from public.courses c
    join public.organization_members om on om.org_id = c.org_id
    where c.org_id is not null
      and om.user_id = v_uid
      and om.role in ('owner', 'teacher')
      and (p_org_id is null or c.org_id = p_org_id)
    union
    select c.id as course_id, 'teacher'::text as my_course_role
    from public.courses c
    join public.organization_member_roles omr on omr.org_id = c.org_id
    where c.org_id is not null
      and omr.user_id = v_uid
      and omr.role in ('owner', 'teacher')
      and (p_org_id is null or c.org_id = p_org_id)
    union
    select cm.course_id, cm.role
    from public.course_members cm
    join public.courses c on c.id = cm.course_id
    where cm.user_id = v_uid
      and (p_org_id is null or c.org_id = p_org_id)
  ),
  distinct_visible as (
    select distinct on (v.course_id)
      v.course_id,
      v.my_course_role
    from visible v
    order by v.course_id,
      case v.my_course_role
        when 'student' then 1
        when 'owner' then 2
        when 'teacher' then 3
        else 4
      end
  ),
  latest_subs as (
    select distinct on (s.activity_id, s.user_id)
      s.activity_id,
      s.user_id,
      s.status
    from public.activity_submissions s
    order by s.activity_id, s.user_id, s.version desc
  )
  select
    dv.course_id,
    c.title,
    c.org_id,
    coalesce(o.name, ''),
    c.classroom_course_id,
    dv.my_course_role,
    (
      select count(*)::bigint
      from public.course_members cm
      where cm.course_id = dv.course_id and cm.role = 'student'
    ),
    (
      select count(*)::bigint
      from public.activities a
      where a.course_id = dv.course_id
    ),
    (
      select count(*)::bigint
      from latest_subs ls
      join public.activities a on a.id = ls.activity_id
      where a.course_id = dv.course_id
        and ls.status in ('submitted', 'graded', 'returned')
    ),
    (
      select count(*)::bigint
      from latest_subs ls
      join public.activities a on a.id = ls.activity_id
      where a.course_id = dv.course_id
        and ls.status = 'submitted'
    )
  from distinct_visible dv
  join public.courses c on c.id = dv.course_id
  left join public.organizations o on o.id = c.org_id
  order by c.title;
end;
$$;

grant execute on function public.list_pybotclass_my_courses(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6) Personal-course invites: org_id nullable; redeem adds course_members only
-- ──────────────────────────────────────────────────────────────────────────

alter table public.organization_invites
  alter column org_id drop not null;

drop policy if exists oi_insert_staff on public.organization_invites;
create policy oi_insert_staff on public.organization_invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (
        org_id is not null
        and public.is_org_staff(org_id)
        and (
          course_id is null
          or (
            public.is_course_org_staff(course_id)
            and exists (
              select 1
              from public.courses c
              where c.id = course_id
                and c.org_id = organization_invites.org_id
            )
          )
        )
      )
      or (
        org_id is null
        and course_id is not null
        and public.is_course_teacher(course_id)
        and exists (
          select 1
          from public.courses c
          where c.id = course_id
            and c.org_id is null
        )
      )
    )
  );

drop policy if exists oi_select_staff on public.organization_invites;
create policy oi_select_staff on public.organization_invites
  for select using (
    (org_id is not null and public.is_org_staff(org_id))
    or (course_id is not null and public.is_course_teacher(course_id))
  );

drop policy if exists oi_delete_staff on public.organization_invites;
create policy oi_delete_staff on public.organization_invites
  for delete using (
    (org_id is not null and public.is_org_staff(org_id))
    or (course_id is not null and public.is_course_teacher(course_id))
  );

create or replace function public.redeem_org_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.organization_invites%rowtype;
  key text := lower(trim(coalesce(invite_code, '')));
  v_course_org uuid;
  v_already_org boolean;
  v_cm_role text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if key = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_code');
  end if;

  select * into inv from public.organization_invites where code = key for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if inv.expires_at is not null and inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if inv.use_count >= inv.max_uses then
    return jsonb_build_object('ok', false, 'error', 'max_uses');
  end if;

  -- Personal course invite (no institution)
  if inv.course_id is not null and inv.org_id is null then
    select c.org_id into v_course_org
    from public.courses c
    where c.id = inv.course_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    if v_course_org is not null then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    v_cm_role := case
      when inv.role in ('teacher', 'student') then inv.role
      else 'student'
    end;

    insert into public.course_members (
      course_id, user_id, role, source
    )
    values (
      inv.course_id, auth.uid(), v_cm_role, 'invite'
    )
    on conflict (course_id, user_id) do update
    set
      role = excluded.role,
      source = excluded.source;

    update public.organization_invites
    set use_count = use_count + 1
    where id = inv.id;

    return jsonb_build_object(
      'ok', true,
      'org_id', null,
      'course_id', inv.course_id,
      'role', inv.role
    );
  end if;

  -- Course invite tied to an institution (existing behavior)
  if inv.course_id is not null then
    select c.org_id into v_course_org
    from public.courses c
    where c.id = inv.course_id;

    if v_course_org is null then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    if v_course_org <> inv.org_id then
      return jsonb_build_object('ok', false, 'error', 'curso_invalido');
    end if;

    select exists (
      select 1
      from public.organization_members om
      where om.org_id = inv.org_id
        and om.user_id = auth.uid()
    ) into v_already_org;

    if not v_already_org then
      insert into public.organization_members (org_id, user_id, role)
      values (inv.org_id, auth.uid(), inv.role);
    end if;

    insert into public.organization_member_roles (org_id, user_id, role)
    values (inv.org_id, auth.uid(), inv.role)
    on conflict (org_id, user_id, role) do nothing;

    v_cm_role := case
      when inv.role in ('teacher', 'student') then inv.role
      else 'student'
    end;

    insert into public.course_members (
      course_id,
      user_id,
      role,
      source
    )
    values (
      inv.course_id,
      auth.uid(),
      v_cm_role,
      'invite'
    )
    on conflict (course_id, user_id) do update
    set
      role = excluded.role,
      source = excluded.source;

    update public.organization_invites
    set use_count = use_count + 1
    where id = inv.id;

    return jsonb_build_object(
      'ok', true,
      'org_id', inv.org_id,
      'course_id', inv.course_id,
      'role', inv.role
    );
  end if;

  -- Org-only invite (existing behavior)
  if exists (
    select 1
    from public.organization_members om
    where om.org_id = inv.org_id
      and om.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  insert into public.organization_members (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role);

  insert into public.organization_member_roles (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id, role) do nothing;

  update public.organization_invites
  set use_count = use_count + 1
  where id = inv.id;

  return jsonb_build_object(
    'ok', true,
    'org_id', inv.org_id,
    'course_id', null,
    'role', inv.role
  );
end;
$$;

grant execute on function public.redeem_org_invite(text) to authenticated;
