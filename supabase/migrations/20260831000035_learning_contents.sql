-- Mi Contenido — biblioteca personal de contenidos educativos (Fase 1)
-- Jerarquía: learning_contents → content_units → content_lessons → lesson_blocks

-- --- Contenidos --------------------------------------------------------------

create table if not exists public.learning_contents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_contents_status_check check (status in ('draft', 'published'))
);

create index if not exists learning_contents_owner_id_idx on public.learning_contents (owner_id);
create index if not exists learning_contents_updated_at_idx on public.learning_contents (updated_at desc);

alter table public.learning_contents enable row level security;

create policy learning_contents_select_own on public.learning_contents
  for select using (owner_id = auth.uid());

create policy learning_contents_insert_own on public.learning_contents
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy learning_contents_update_own on public.learning_contents
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy learning_contents_delete_own on public.learning_contents
  for delete using (owner_id = auth.uid());

-- --- Unidades ----------------------------------------------------------------

create table if not exists public.content_units (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.learning_contents (id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_units_content_id_idx on public.content_units (content_id);
create index if not exists content_units_content_position_idx on public.content_units (content_id, position);

alter table public.content_units enable row level security;

create policy content_units_select_own on public.content_units
  for select using (
    exists (
      select 1
      from public.learning_contents lc
      where lc.id = content_units.content_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_units_insert_own on public.content_units
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.learning_contents lc
      where lc.id = content_units.content_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_units_update_own on public.content_units
  for update using (
    exists (
      select 1
      from public.learning_contents lc
      where lc.id = content_units.content_id
        and lc.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.learning_contents lc
      where lc.id = content_units.content_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_units_delete_own on public.content_units
  for delete using (
    exists (
      select 1
      from public.learning_contents lc
      where lc.id = content_units.content_id
        and lc.owner_id = auth.uid()
    )
  );

-- --- Lecciones ---------------------------------------------------------------

create table if not exists public.content_lessons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.content_units (id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_lessons_unit_id_idx on public.content_lessons (unit_id);
create index if not exists content_lessons_unit_position_idx on public.content_lessons (unit_id, position);

alter table public.content_lessons enable row level security;

create policy content_lessons_select_own on public.content_lessons
  for select using (
    exists (
      select 1
      from public.content_units u
      join public.learning_contents lc on lc.id = u.content_id
      where u.id = content_lessons.unit_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_lessons_insert_own on public.content_lessons
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.content_units u
      join public.learning_contents lc on lc.id = u.content_id
      where u.id = content_lessons.unit_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_lessons_update_own on public.content_lessons
  for update using (
    exists (
      select 1
      from public.content_units u
      join public.learning_contents lc on lc.id = u.content_id
      where u.id = content_lessons.unit_id
        and lc.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.content_units u
      join public.learning_contents lc on lc.id = u.content_id
      where u.id = content_lessons.unit_id
        and lc.owner_id = auth.uid()
    )
  );

create policy content_lessons_delete_own on public.content_lessons
  for delete using (
    exists (
      select 1
      from public.content_units u
      join public.learning_contents lc on lc.id = u.content_id
      where u.id = content_lessons.unit_id
        and lc.owner_id = auth.uid()
    )
  );

-- --- Bloques -----------------------------------------------------------------

create table if not exists public.lesson_blocks (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.content_lessons (id) on delete cascade,
  block_type text not null,
  title text,
  content text,
  starter_code text,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_blocks_type_check check (block_type in ('theory', 'example', 'exercise', 'task'))
);

create index if not exists lesson_blocks_lesson_id_idx on public.lesson_blocks (lesson_id);
create index if not exists lesson_blocks_lesson_position_idx on public.lesson_blocks (lesson_id, position);

alter table public.lesson_blocks enable row level security;

create policy lesson_blocks_select_own on public.lesson_blocks
  for select using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = lesson_blocks.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

create policy lesson_blocks_insert_own on public.lesson_blocks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = lesson_blocks.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

create policy lesson_blocks_update_own on public.lesson_blocks
  for update using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = lesson_blocks.lesson_id
        and lc.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = lesson_blocks.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

create policy lesson_blocks_delete_own on public.lesson_blocks
  for delete using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = lesson_blocks.lesson_id
        and lc.owner_id = auth.uid()
    )
  );
