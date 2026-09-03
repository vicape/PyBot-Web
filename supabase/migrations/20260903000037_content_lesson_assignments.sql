-- Asignar lecciones de Mi Contenido a actividades de curso
-- (todo el curso o subset de alumnos vía activity_assignees).

-- ── Columna de vínculo ──────────────────────────────────────────────────────

alter table public.activities
  add column if not exists content_lesson_id uuid
    references public.content_lessons (id) on delete set null;

create index if not exists activities_content_lesson_id_idx
  on public.activities (content_lesson_id)
  where content_lesson_id is not null;

-- ── Assignees (vacío = todo el curso) ───────────────────────────────────────

create table if not exists public.activity_assignees (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create index if not exists activity_assignees_user_id_idx
  on public.activity_assignees (user_id);

alter table public.activity_assignees enable row level security;

-- ── Helpers (security definer para evitar recursión RLS) ────────────────────

create or replace function public.activity_has_assignees(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_assignees aa
    where aa.activity_id = p_activity_id
  );
$$;

create or replace function public.is_activity_assignee(p_activity_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_assignees aa
    where aa.activity_id = p_activity_id
      and aa.user_id = p_user_id
  );
$$;

create or replace function public.activity_visible_to_me(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activities a
    where a.id = p_activity_id
      and (
        public.is_course_teacher(a.course_id)
        or (
          exists (
            select 1
            from public.course_members cm
            where cm.course_id = a.course_id
              and cm.user_id = auth.uid()
          )
          and (
            not public.activity_has_assignees(a.id)
            or public.is_activity_assignee(a.id, auth.uid())
          )
        )
      )
  );
$$;

create or replace function public.can_access_assigned_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activities a
    where a.content_lesson_id = p_lesson_id
      and public.activity_visible_to_me(a.id)
  );
$$;

-- Helpers para policies de units/contents: evitar subqueries RLS cruzadas
-- (content_units ↔ content_lessons) que provocan "infinite recursion".
create or replace function public.can_access_assigned_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_lessons l
    join public.activities a on a.content_lesson_id = l.id
    where l.unit_id = p_unit_id
      and public.activity_visible_to_me(a.id)
  );
$$;

create or replace function public.can_access_assigned_content(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_units u
    join public.content_lessons l on l.unit_id = u.id
    join public.activities a on a.content_lesson_id = l.id
    where u.content_id = p_content_id
      and public.activity_visible_to_me(a.id)
  );
$$;

grant execute on function public.activity_has_assignees(uuid) to authenticated;
grant execute on function public.is_activity_assignee(uuid, uuid) to authenticated;
grant execute on function public.activity_visible_to_me(uuid) to authenticated;
grant execute on function public.can_access_assigned_lesson(uuid) to authenticated;
grant execute on function public.can_access_assigned_unit(uuid) to authenticated;
grant execute on function public.can_access_assigned_content(uuid) to authenticated;

-- ── activities SELECT con assignees ─────────────────────────────────────────

drop policy if exists activities_select_member on public.activities;
create policy activities_select_member on public.activities
  for select using (
    public.is_course_teacher(course_id)
    or (
      exists (
        select 1
        from public.course_members cm
        where cm.course_id = activities.course_id
          and cm.user_id = auth.uid()
      )
      and (
        not public.activity_has_assignees(id)
        or public.is_activity_assignee(id, auth.uid())
      )
    )
  );

-- ── activity_assignees RLS ──────────────────────────────────────────────────

drop policy if exists activity_assignees_select on public.activity_assignees;
create policy activity_assignees_select on public.activity_assignees
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.activities a
      where a.id = activity_assignees.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

drop policy if exists activity_assignees_insert_teacher on public.activity_assignees;
create policy activity_assignees_insert_teacher on public.activity_assignees
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.activities a
      join public.course_members cm
        on cm.course_id = a.course_id
       and cm.user_id = activity_assignees.user_id
       and cm.role = 'student'
      where a.id = activity_assignees.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

drop policy if exists activity_assignees_delete_teacher on public.activity_assignees;
create policy activity_assignees_delete_teacher on public.activity_assignees
  for delete using (
    exists (
      select 1
      from public.activities a
      where a.id = activity_assignees.activity_id
        and public.is_course_teacher(a.course_id)
    )
  );

-- ── Lectura de lecciones asignadas ──────────────────────────────────────────

drop policy if exists content_lessons_select_assigned on public.content_lessons;
create policy content_lessons_select_assigned on public.content_lessons
  for select using (public.can_access_assigned_lesson(id));

drop policy if exists content_units_select_assigned on public.content_units;
create policy content_units_select_assigned on public.content_units
  for select using (public.can_access_assigned_unit(id));

drop policy if exists learning_contents_select_assigned on public.learning_contents;
create policy learning_contents_select_assigned on public.learning_contents
  for select using (public.can_access_assigned_content(id));

drop policy if exists lesson_blocks_select_assigned on public.lesson_blocks;
create policy lesson_blocks_select_assigned on public.lesson_blocks
  for select using (public.can_access_assigned_lesson(lesson_id));

-- ── Media de lecciones asignadas (path: owner/content/lesson/file) ──────────

drop policy if exists content_media_select_assigned on storage.objects;
create policy content_media_select_assigned
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'content-media'
    and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_access_assigned_lesson(((storage.foldername(name))[3])::uuid)
  );
