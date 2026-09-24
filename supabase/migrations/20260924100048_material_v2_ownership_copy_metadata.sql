-- Material V2: pedagogical metadata, typed structure, copy provenance, deep-copy RPC.
-- Additive / backwards-compatible. Does not rewrite legacy metadata values.
-- Ownership: owner-only UPDATE/DELETE unchanged. Provenance never grants privileges.

-- ── learning_contents: metadata + provenance ────────────────────────────────

alter table public.learning_contents
  add column if not exists language_code text,
  add column if not exists recommended_age_min integer,
  add column if not exists recommended_age_max integer,
  add column if not exists estimated_minutes integer,
  add column if not exists difficulty text,
  add column if not exists subject text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists learning_objectives text[] not null default '{}'::text[],
  add column if not exists prerequisites text[] not null default '{}'::text[],
  add column if not exists copied_from_content_id uuid,
  add column if not exists original_content_id uuid,
  add column if not exists original_owner_id uuid;

alter table public.learning_contents
  drop constraint if exists learning_contents_difficulty_check;
alter table public.learning_contents
  add constraint learning_contents_difficulty_check
  check (
    difficulty is null
    or difficulty in ('beginner', 'intermediate', 'advanced')
  );

alter table public.learning_contents
  drop constraint if exists learning_contents_age_range_check;
alter table public.learning_contents
  add constraint learning_contents_age_range_check
  check (
    (recommended_age_min is null and recommended_age_max is null)
    or (
      recommended_age_min is not null
      and recommended_age_max is not null
      and recommended_age_min >= 3
      and recommended_age_max <= 120
      and recommended_age_min <= recommended_age_max
    )
  );

alter table public.learning_contents
  drop constraint if exists learning_contents_estimated_minutes_check;
alter table public.learning_contents
  add constraint learning_contents_estimated_minutes_check
  check (estimated_minutes is null or estimated_minutes > 0);

-- Safe FKs: deleting source must not delete copies
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_contents_copied_from_content_id_fkey'
  ) then
    alter table public.learning_contents
      add constraint learning_contents_copied_from_content_id_fkey
      foreign key (copied_from_content_id)
      references public.learning_contents (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_contents_original_content_id_fkey'
  ) then
    alter table public.learning_contents
      add constraint learning_contents_original_content_id_fkey
      foreign key (original_content_id)
      references public.learning_contents (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_contents_original_owner_id_fkey'
  ) then
    alter table public.learning_contents
      add constraint learning_contents_original_owner_id_fkey
      foreign key (original_owner_id)
      references auth.users (id)
      on delete set null;
  end if;
end $$;

create index if not exists learning_contents_copied_from_idx
  on public.learning_contents (copied_from_content_id)
  where copied_from_content_id is not null;

create index if not exists learning_contents_original_content_idx
  on public.learning_contents (original_content_id)
  where original_content_id is not null;

-- ── content_units: classification ───────────────────────────────────────────

alter table public.content_units
  add column if not exists unit_type text not null default 'unit',
  add column if not exists estimated_minutes integer;

alter table public.content_units
  drop constraint if exists content_units_unit_type_check;
alter table public.content_units
  add constraint content_units_unit_type_check
  check (unit_type in ('chapter', 'unit', 'section'));

alter table public.content_units
  drop constraint if exists content_units_estimated_minutes_check;
alter table public.content_units
  add constraint content_units_estimated_minutes_check
  check (estimated_minutes is null or estimated_minutes > 0);

-- ── content_lessons: item_type ──────────────────────────────────────────────

alter table public.content_lessons
  add column if not exists item_type text not null default 'lesson',
  add column if not exists estimated_minutes integer;

alter table public.content_lessons
  drop constraint if exists content_lessons_item_type_check;
alter table public.content_lessons
  add constraint content_lessons_item_type_check
  check (
    item_type in (
      'lesson', 'theory', 'example', 'activity', 'exercise',
      'quiz', 'test', 'project', 'resource'
    )
  );

alter table public.content_lessons
  drop constraint if exists content_lessons_estimated_minutes_check;
alter table public.content_lessons
  add constraint content_lessons_estimated_minutes_check
  check (estimated_minutes is null or estimated_minutes > 0);

-- ── Provenance integrity: client cannot forge lineage on insert/update ──────
-- Provenance never affects RLS; still clear forged client values unless copy RPC.

create or replace function public.learning_contents_guard_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copying text;
begin
  begin
    v_copying := current_setting('pybot.copying_content', true);
  exception when others then
    v_copying := null;
  end;

  if coalesce(v_copying, '') = '1' then
    return new;
  end if;

  -- Direct client writes: strip provenance (fail-closed display integrity)
  if tg_op = 'INSERT' then
    new.copied_from_content_id := null;
    new.original_content_id := null;
    new.original_owner_id := null;
  elsif tg_op = 'UPDATE' then
    new.copied_from_content_id := old.copied_from_content_id;
    new.original_content_id := old.original_content_id;
    new.original_owner_id := old.original_owner_id;
  end if;

  return new;
end;
$$;

drop trigger if exists learning_contents_guard_provenance_trg on public.learning_contents;
create trigger learning_contents_guard_provenance_trg
  before insert or update on public.learning_contents
  for each row
  execute function public.learning_contents_guard_provenance();

-- ── Deep copy RPC (fail-closed on can_read; no service-role in client) ──────

create or replace function public.copy_learning_content(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_src public.learning_contents%rowtype;
  v_new_id uuid;
  v_root_id uuid;
  v_root_owner uuid;
  v_unit record;
  v_lesson record;
  v_block record;
  v_new_unit_id uuid;
  v_new_lesson_id uuid;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_source_id is null then
    raise exception 'missing_source';
  end if;

  if not public.can_read_learning_content(p_source_id) then
    raise exception 'forbidden_read';
  end if;

  select * into v_src
  from public.learning_contents
  where id = p_source_id;

  if not found then
    raise exception 'not_found';
  end if;

  -- Lineage root: retain original when re-copying a copy
  v_root_id := coalesce(v_src.original_content_id, v_src.id);
  v_root_owner := coalesce(v_src.original_owner_id, v_src.owner_id);

  v_title := trim(both from coalesce(v_src.title, ''));
  if v_title = '' then
    v_title := 'Sin título';
  end if;
  if length(v_title) > 200 then
    v_title := left(v_title, 200);
  end if;
  v_title := v_title || ' (copia)';

  perform set_config('pybot.copying_content', '1', true);

  insert into public.learning_contents (
    owner_id,
    title,
    description,
    status,
    visibility,
    language_code,
    recommended_age_min,
    recommended_age_max,
    estimated_minutes,
    difficulty,
    subject,
    tags,
    learning_objectives,
    prerequisites,
    copied_from_content_id,
    original_content_id,
    original_owner_id
  ) values (
    v_uid,
    v_title,
    v_src.description,
    'draft',
    'private',
    v_src.language_code,
    v_src.recommended_age_min,
    v_src.recommended_age_max,
    v_src.estimated_minutes,
    v_src.difficulty,
    v_src.subject,
    coalesce(v_src.tags, '{}'::text[]),
    coalesce(v_src.learning_objectives, '{}'::text[]),
    coalesce(v_src.prerequisites, '{}'::text[]),
    v_src.id,
    v_root_id,
    v_root_owner
  )
  returning id into v_new_id;

  for v_unit in
    select *
    from public.content_units
    where content_id = v_src.id
    order by position asc, created_at asc
  loop
    insert into public.content_units (
      content_id, title, description, position, unit_type, estimated_minutes
    ) values (
      v_new_id,
      v_unit.title,
      v_unit.description,
      v_unit.position,
      coalesce(nullif(v_unit.unit_type, ''), 'unit'),
      v_unit.estimated_minutes
    )
    returning id into v_new_unit_id;

    for v_lesson in
      select *
      from public.content_lessons
      where unit_id = v_unit.id
      order by position asc, created_at asc
    loop
      insert into public.content_lessons (
        unit_id,
        title,
        description,
        position,
        document_json,
        document_version,
        item_type,
        estimated_minutes
      ) values (
        v_new_unit_id,
        v_lesson.title,
        v_lesson.description,
        v_lesson.position,
        v_lesson.document_json,
        coalesce(v_lesson.document_version, 1),
        coalesce(nullif(v_lesson.item_type, ''), 'lesson'),
        v_lesson.estimated_minutes
      )
      returning id into v_new_lesson_id;

      for v_block in
        select *
        from public.lesson_blocks
        where lesson_id = v_lesson.id
        order by position asc, created_at asc
      loop
        insert into public.lesson_blocks (
          lesson_id,
          block_type,
          title,
          content,
          starter_code,
          position,
          metadata
        ) values (
          v_new_lesson_id,
          v_block.block_type,
          v_block.title,
          v_block.content,
          v_block.starter_code,
          v_block.position,
          coalesce(v_block.metadata, '{}'::jsonb)
        );
      end loop;
    end loop;
  end loop;

  perform set_config('pybot.copying_content', '', true);

  return v_new_id;
exception
  when others then
    perform set_config('pybot.copying_content', '', true);
    raise;
end;
$$;

revoke all on function public.copy_learning_content(uuid) from public;
grant execute on function public.copy_learning_content(uuid) to authenticated;

comment on function public.copy_learning_content(uuid) is
  'Deep-copies readable learning_content for the caller. Provenance: copied_from, original_content_id, original_owner_id. Media blobs are not duplicated (refs remain readable via can_read if source still readable).';

comment on column public.learning_contents.language_code is
  'ISO-style language code (es, en, fr, pt, de, …). Null for legacy.';
comment on column public.learning_contents.difficulty is
  'Stable: beginner | intermediate | advanced. Null for legacy.';
comment on column public.content_units.unit_type is
  'Stable: chapter | unit | section. Default unit for existing rows.';
comment on column public.content_lessons.item_type is
  'Stable pedagogical item type. Default lesson for existing rows.';
