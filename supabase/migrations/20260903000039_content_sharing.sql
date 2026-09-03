-- Sharing: visibility + content_course_access + RLS lectura (sin recursion)

alter table public.learning_contents
  add column if not exists visibility text not null default 'private';

alter table public.learning_contents
  drop constraint if exists learning_contents_visibility_check;

alter table public.learning_contents
  add constraint learning_contents_visibility_check
  check (visibility in ('private', 'courses', 'community'));

create table if not exists public.content_course_access (
  content_id uuid not null references public.learning_contents (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (content_id, course_id)
);

create index if not exists content_course_access_course_id_idx
  on public.content_course_access (course_id);

alter table public.content_course_access enable row level security;

-- ── Helpers SECURITY DEFINER ────────────────────────────────────────────────

create or replace function public.is_learning_content_owner(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.learning_contents lc
    where lc.id = p_content_id
      and lc.owner_id = auth.uid()
  );
$$;

create or replace function public.can_read_learning_content(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.learning_contents lc
    where lc.id = p_content_id
      and (
        lc.owner_id = auth.uid()
        or lc.visibility = 'community'
        or (
          lc.visibility = 'courses'
          and exists (
            select 1
            from public.content_course_access cca
            join public.course_members cm on cm.course_id = cca.course_id
            where cca.content_id = lc.id
              and cm.user_id = auth.uid()
          )
        )
        or exists (
          select 1
          from public.content_units u
          join public.content_lessons l on l.unit_id = u.id
          join public.activities a on a.content_lesson_id = l.id
          where u.content_id = lc.id
            and public.activity_visible_to_me(a.id)
        )
      )
  );
$$;

create or replace function public.can_read_content_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_units u
    where u.id = p_unit_id
      and (
        public.can_read_learning_content(u.content_id)
        or exists (
          select 1
          from public.content_lessons l
          join public.activities a on a.content_lesson_id = l.id
          where l.unit_id = u.id
            and public.activity_visible_to_me(a.id)
        )
      )
  );
$$;

create or replace function public.can_read_content_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_lessons l
    join public.content_units u on u.id = l.unit_id
    where l.id = p_lesson_id
      and (
        public.can_read_learning_content(u.content_id)
        or public.can_access_assigned_lesson(p_lesson_id)
      )
  );
$$;

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

  return false;
end;
$$;

grant execute on function public.is_learning_content_owner(uuid) to authenticated;
grant execute on function public.can_read_learning_content(uuid) to authenticated;
grant execute on function public.can_read_content_unit(uuid) to authenticated;
grant execute on function public.can_read_content_lesson(uuid) to authenticated;
grant execute on function public.can_read_content_media_path(text) to authenticated;

-- ── content_course_access RLS ───────────────────────────────────────────────

drop policy if exists cca_select_relevant on public.content_course_access;
create policy cca_select_relevant on public.content_course_access
  for select using (
    public.is_learning_content_owner(content_id)
    or public.is_course_teacher(course_id)
    or exists (
      select 1 from public.course_members cm
      where cm.course_id = content_course_access.course_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists cca_insert_owner on public.content_course_access;
create policy cca_insert_owner on public.content_course_access
  for insert to authenticated
  with check (public.is_learning_content_owner(content_id));

drop policy if exists cca_delete_owner on public.content_course_access;
create policy cca_delete_owner on public.content_course_access
  for delete using (public.is_learning_content_owner(content_id));

-- ── Replace assigned-only SELECT policies with can_read_* ───────────────────

drop policy if exists learning_contents_select_assigned on public.learning_contents;
drop policy if exists learning_contents_select_shared on public.learning_contents;
create policy learning_contents_select_shared on public.learning_contents
  for select using (public.can_read_learning_content(id));

drop policy if exists content_units_select_assigned on public.content_units;
drop policy if exists content_units_select_shared on public.content_units;
create policy content_units_select_shared on public.content_units
  for select using (public.can_read_content_unit(id));

drop policy if exists content_lessons_select_assigned on public.content_lessons;
drop policy if exists content_lessons_select_shared on public.content_lessons;
create policy content_lessons_select_shared on public.content_lessons
  for select using (public.can_read_content_lesson(id));

drop policy if exists lesson_blocks_select_assigned on public.lesson_blocks;
drop policy if exists lesson_blocks_select_shared on public.lesson_blocks;
create policy lesson_blocks_select_shared on public.lesson_blocks
  for select using (public.can_read_content_lesson(lesson_id));

-- Media: keep owner write; broaden select via helper
drop policy if exists content_media_select_assigned on storage.objects;
drop policy if exists content_media_select_shared on storage.objects;
create policy content_media_select_shared
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'content-media'
    and public.can_read_content_media_path(name)
  );
