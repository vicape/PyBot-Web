-- Cursos y actividades PyBot por colegio (ejecutar después de 20260216000001).

-- --- Cursos ------------------------------------------------------------------

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  classroom_course_id text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now()
);

create index if not exists courses_org_id_idx on public.courses (org_id);

alter table public.courses enable row level security;

create policy courses_select_member on public.courses
  for select using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = courses.org_id
        and m.user_id = auth.uid()
    )
  );

create policy courses_insert_staff on public.courses
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.organization_members m
      where m.org_id = courses.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

-- --- Actividades (tareas en el IDE) -----------------------------------------

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  starter_code text not null default '',
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now()
);

create index if not exists activities_course_id_idx on public.activities (course_id);

alter table public.activities enable row level security;

create policy activities_select_member on public.activities
  for select using (
    exists (
      select 1
      from public.courses c
      join public.organization_members m on m.org_id = c.org_id
      where c.id = activities.course_id
        and m.user_id = auth.uid()
    )
  );

create policy activities_insert_staff on public.activities
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.courses c
      join public.organization_members m on m.org_id = c.org_id
      where c.id = activities.course_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );

-- --- Progreso código por alumno ---------------------------------------------

create table if not exists public.activity_progress (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null default '',
  updated_at timestamptz default now(),
  primary key (activity_id, user_id)
);

alter table public.activity_progress enable row level security;

create policy ap_select_own on public.activity_progress
  for select using (user_id = auth.uid());

create policy ap_insert_enrolled on public.activity_progress
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.activities act
      join public.courses co on co.id = act.course_id
      join public.organization_members m on m.org_id = co.org_id
      where act.id = activity_progress.activity_id
        and m.user_id = auth.uid()
    )
  );

create policy ap_update_own on public.activity_progress
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
