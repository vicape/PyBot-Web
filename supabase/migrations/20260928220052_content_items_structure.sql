-- Definitive Content hierarchy: learning_contents -> content_units -> content_lessons -> content_items
-- EXECUTION ENVIRONMENT: CLOUD via MaxCloud only
-- BASELINE: 7d478645c552b241461ad5c050df40fb38fc55d7
-- Authoritative: Unit contains Lessons only; Lesson contains Items only; Item is always a leaf.
-- Legacy type mapping: reading/resource/theory->material; activity->exercise; test->assessment;
--   project->assignment; example/exercise/quiz/video/assignment unchanged.
-- PRESERVE: auth, OAuth, Classroom, orgs, courses, membership, roles, Library, Community,
--   sharing, provenance, visibility, assignment/submission/activity flows, existing student
--   progress outside this refactor, BlockNote, media, IDE, Pyodide, Monaco, ESP32, EDA6,
--   Web Serial, BLE, hardware, telemetry, typography, localization.

-- ── Helper: map legacy item / block types to canonical item types ───────────

create or replace function public.map_legacy_content_item_type(p_type text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(nullif(trim(p_type), ''), 'material'))
    when 'reading' then 'material'
    when 'resource' then 'material'
    when 'theory' then 'material'
    when 'activity' then 'exercise'
    when 'test' then 'assessment'
    when 'project' then 'assignment'
    when 'example' then 'example'
    when 'exercise' then 'exercise'
    when 'quiz' then 'quiz'
    when 'video' then 'video'
    when 'assignment' then 'assignment'
    when 'material' then 'material'
    when 'assessment' then 'assessment'
    when 'task' then 'assignment'
    else 'material'
  end;
$$;

comment on function public.map_legacy_content_item_type(text) is
  'Maps legacy Content V3 / lesson_blocks types to canonical content_items.type values.';

-- ── content_items table ─────────────────────────────────────────────────────

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.content_lessons (id) on delete cascade,
  type text not null,
  title text not null,
  position integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_type_check check (
    type in (
      'material',
      'video',
      'example',
      'exercise',
      'quiz',
      'assignment',
      'assessment'
    )
  )
);

create index if not exists content_items_lesson_id_idx
  on public.content_items (lesson_id);

create index if not exists content_items_lesson_position_idx
  on public.content_items (lesson_id, position);

comment on table public.content_items is
  'Definitive Lesson Items (leaves). Hierarchy: learning_contents -> content_units -> content_lessons -> content_items.';

comment on column public.content_items.content is
  'Pedagogical payload (BlockNote document data, text, media refs, questions, code, files, links, etc.).';

comment on column public.content_items.config is
  'Item behaviour/configuration (quiz/assignment/assessment/video/completion settings). No student state.';

alter table public.content_items enable row level security;

-- Owner write policies via ownership chain
drop policy if exists content_items_select_own on public.content_items;
create policy content_items_select_own on public.content_items
  for select using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = content_items.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

drop policy if exists content_items_insert_own on public.content_items;
create policy content_items_insert_own on public.content_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = content_items.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

drop policy if exists content_items_update_own on public.content_items;
create policy content_items_update_own on public.content_items
  for update using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = content_items.lesson_id
        and lc.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = content_items.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

drop policy if exists content_items_delete_own on public.content_items;
create policy content_items_delete_own on public.content_items
  for delete using (
    exists (
      select 1
      from public.content_lessons l
      join public.content_units u on u.id = l.unit_id
      join public.learning_contents lc on lc.id = u.content_id
      where l.id = content_items.lesson_id
        and lc.owner_id = auth.uid()
    )
  );

-- Shared / community / assigned read follows parent lesson access
create or replace function public.can_read_content_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_items i
    where i.id = p_item_id
      and public.can_read_content_lesson(i.lesson_id)
  );
$$;

grant execute on function public.can_read_content_item(uuid) to authenticated;

drop policy if exists content_items_select_shared on public.content_items;
create policy content_items_select_shared on public.content_items
  for select using (public.can_read_content_item(id));

-- ── Data migration helpers ──────────────────────────────────────────────────

create or replace function public.content_item_config_from_lesson_row(r public.content_lessons)
returns jsonb
language plpgsql
stable
as $$
declare
  cfg jsonb := '{}'::jsonb;
begin
  cfg := jsonb_strip_nulls(jsonb_build_object(
    'description', r.description,
    'estimated_minutes', r.estimated_minutes,
    'required', coalesce(r.required, true),
    'completion_rule', coalesce(nullif(r.completion_rule, ''), 'none'),
    'grading_mode', coalesce(nullif(r.grading_mode, ''), 'none'),
    'passing_score', r.passing_score,
    'completion_threshold', r.completion_threshold,
    'learning_objectives', to_jsonb(coalesce(r.learning_objectives, '{}'::text[]))
  ));
  return cfg;
exception
  when undefined_column then
    return jsonb_build_object('description', r.description);
end;
$$;

-- B: nested child items (parent_lesson_id IS NOT NULL) -> content_items
do $$
declare
  r record;
  v_type text;
  v_content jsonb;
  v_config jsonb;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_lessons'
      and column_name = 'parent_lesson_id'
  ) then
    return;
  end if;

  for r in
    select *
    from public.content_lessons
    where parent_lesson_id is not null
    order by position asc, created_at asc, id asc
  loop
    v_type := public.map_legacy_content_item_type(r.item_type);
    v_content := jsonb_build_object(
      'document_json', coalesce(r.document_json, '[]'::jsonb),
      'document_version', coalesce(r.document_version, 1)
    );
    begin
      v_config := public.content_item_config_from_lesson_row(r);
    exception when others then
      v_config := jsonb_build_object('description', r.description);
    end;

    insert into public.content_items (
      id, lesson_id, type, title, position, content, config, created_at, updated_at
    ) values (
      r.id,
      r.parent_lesson_id,
      v_type,
      coalesce(nullif(trim(r.title), ''), 'Sin título'),
      coalesce(r.position, 0),
      v_content,
      v_config,
      r.created_at,
      r.updated_at
    )
    on conflict (id) do nothing;
  end loop;

  delete from public.content_lessons where parent_lesson_id is not null;
end $$;

-- C: top-level non-lesson items under Unit -> wrap in Lesson + migrate item
do $$
declare
  r record;
  v_new_lesson_id uuid;
  v_type text;
  v_content jsonb;
  v_config jsonb;
  v_unit uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_lessons'
      and column_name = 'item_type'
  ) then
    return;
  end if;

  for r in
    select *
    from public.content_lessons
    where parent_lesson_id is null
      and coalesce(item_type, 'lesson') is distinct from 'lesson'
    order by unit_id asc, position asc, created_at asc, id asc
  loop
    v_new_lesson_id := gen_random_uuid();
    v_type := public.map_legacy_content_item_type(r.item_type);
    v_content := jsonb_build_object(
      'document_json', coalesce(r.document_json, '[]'::jsonb),
      'document_version', coalesce(r.document_version, 1)
    );
    begin
      v_config := public.content_item_config_from_lesson_row(r);
    exception when others then
      v_config := jsonb_build_object('description', r.description);
    end;

    insert into public.content_lessons (
      id, unit_id, title, description, position, created_at, updated_at,
      document_json, document_version
    ) values (
      v_new_lesson_id,
      r.unit_id,
      coalesce(nullif(trim(r.title), ''), 'Sin título'),
      r.description,
      r.position,
      r.created_at,
      r.updated_at,
      '[]'::jsonb,
      1
    );

    insert into public.content_items (
      id, lesson_id, type, title, position, content, config, created_at, updated_at
    ) values (
      r.id,
      v_new_lesson_id,
      v_type,
      coalesce(nullif(trim(r.title), ''), 'Sin título'),
      0,
      v_content,
      v_config,
      r.created_at,
      r.updated_at
    )
    on conflict (id) do nothing;

    delete from public.content_lessons where id = r.id;
  end loop;

  -- Reindex sibling Lesson positions per unit (stable by position, created_at, id)
  for v_unit in
    select distinct unit_id from public.content_lessons
  loop
    with ordered as (
      select id, row_number() over (
        order by position asc, created_at asc, id asc
      ) - 1 as new_pos
      from public.content_lessons
      where unit_id = v_unit
    )
    update public.content_lessons cl
    set position = ordered.new_pos,
        updated_at = cl.updated_at
    from ordered
    where cl.id = ordered.id
      and cl.position is distinct from ordered.new_pos;
  end loop;
end $$;

-- A: existing top-level Lessons — preserve ID; migrate non-empty document to Material item
do $$
declare
  r record;
  v_has_doc boolean;
begin
  for r in
    select *
    from public.content_lessons
    where coalesce(item_type, 'lesson') = 'lesson'
       or not exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'content_lessons'
           and column_name = 'item_type'
       )
  loop
    v_has_doc := (
      r.document_json is not null
      and jsonb_typeof(r.document_json) = 'array'
      and jsonb_array_length(r.document_json) > 0
    );
    if v_has_doc then
      -- Skip if a material with same document already exists for this lesson
      if not exists (
        select 1 from public.content_items ci
        where ci.lesson_id = r.id
          and ci.type = 'material'
          and ci.content->'document_json' = r.document_json
      ) then
        insert into public.content_items (
          lesson_id, type, title, position, content, config, created_at, updated_at
        ) values (
          r.id,
          'material',
          coalesce(nullif(trim(r.title), ''), 'Material'),
          0,
          jsonb_build_object(
            'document_json', r.document_json,
            'document_version', coalesce(r.document_version, 1)
          ),
          '{}'::jsonb,
          r.created_at,
          r.updated_at
        );
      end if;
      -- Clear lesson document so pedagogical content lives on the Material item
      update public.content_lessons
      set document_json = '[]'::jsonb,
          updated_at = updated_at
      where id = r.id;
    end if;
  end loop;
end $$;

-- D: lesson_blocks not already represented by migrated document Material
do $$
declare
  b record;
  v_type text;
  v_pos integer;
  v_has_material_doc boolean;
begin
  for b in
    select lb.*
    from public.lesson_blocks lb
    order by lb.lesson_id, lb.position asc, lb.created_at asc, lb.id asc
  loop
    -- If lesson already has a material item from document_json migration, skip block re-import
    -- when that material already carries the canonical document representation.
    select exists (
      select 1
      from public.content_items ci
      where ci.lesson_id = b.lesson_id
        and ci.type = 'material'
        and ci.content ? 'document_json'
        and jsonb_typeof(ci.content->'document_json') = 'array'
        and jsonb_array_length(ci.content->'document_json') > 0
        and (
          ci.content->'document_json' @> jsonb_build_array(
            jsonb_build_object('type', 'heading')
          )
          or ci.content->'document_json' @> jsonb_build_array(
            jsonb_build_object('type', 'pybotExercise')
          )
          or ci.content->'document_json' @> jsonb_build_array(
            jsonb_build_object('type', 'pybotTask')
          )
          or jsonb_array_length(ci.content->'document_json') > 0
        )
    ) into v_has_material_doc;

    -- Prefer: if any material with non-empty document exists, treat blocks as already represented
    if exists (
      select 1 from public.content_items ci
      where ci.lesson_id = b.lesson_id
        and ci.type = 'material'
        and jsonb_typeof(ci.content->'document_json') = 'array'
        and jsonb_array_length(coalesce(ci.content->'document_json', '[]'::jsonb)) > 0
    ) then
      continue;
    end if;

    -- Skip if an item already migrated from the same block id (idempotent re-run uses block id)
    if exists (select 1 from public.content_items where id = b.id) then
      continue;
    end if;

    v_type := public.map_legacy_content_item_type(b.block_type);
    select coalesce(max(position), -1) + 1 into v_pos
    from public.content_items
    where lesson_id = b.lesson_id;

    insert into public.content_items (
      id, lesson_id, type, title, position, content, config, created_at, updated_at
    ) values (
      b.id,
      b.lesson_id,
      v_type,
      coalesce(nullif(trim(b.title), ''), initcap(v_type)),
      coalesce(b.position, v_pos),
      jsonb_build_object(
        'text', coalesce(b.content, ''),
        'starter_code', coalesce(b.starter_code, ''),
        'metadata', coalesce(b.metadata, '{}'::jsonb),
        'legacy_block_type', b.block_type
      ),
      '{}'::jsonb,
      b.created_at,
      b.updated_at
    )
    on conflict (id) do nothing;
  end loop;
end $$;

-- ── Drop transitional V3 hierarchy machinery (after data safe) ───────────────

drop trigger if exists content_lessons_validate_hierarchy_trg on public.content_lessons;
drop trigger if exists content_lessons_propagate_unit_id_trg on public.content_lessons;
drop function if exists public.content_lessons_validate_hierarchy();
drop function if exists public.content_lessons_propagate_unit_id();

alter table public.content_lessons
  drop constraint if exists content_lessons_parent_not_self_check;
alter table public.content_lessons
  drop constraint if exists content_lessons_parent_lesson_id_fkey;
alter table public.content_lessons
  drop constraint if exists content_lessons_item_type_check;
alter table public.content_lessons
  drop constraint if exists content_lessons_completion_rule_check;
alter table public.content_lessons
  drop constraint if exists content_lessons_grading_mode_check;
alter table public.content_lessons
  drop constraint if exists content_lessons_passing_score_check;
alter table public.content_lessons
  drop constraint if exists content_lessons_completion_threshold_check;

drop index if exists content_lessons_parent_position_idx;
drop index if exists content_lessons_unit_parent_position_idx;

alter table public.content_lessons drop column if exists parent_lesson_id;
alter table public.content_lessons drop column if exists item_type;
alter table public.content_lessons drop column if exists required;
alter table public.content_lessons drop column if exists completion_rule;
alter table public.content_lessons drop column if exists grading_mode;
alter table public.content_lessons drop column if exists passing_score;
alter table public.content_lessons drop column if exists completion_threshold;
alter table public.content_lessons drop column if exists learning_objectives;

comment on table public.content_lessons is
  'Definitive Lesson containers only. Children live in content_items. Hierarchy: Unit -> Lesson -> Item.';

-- ── Deep copy RPC: Content -> Units -> Lessons -> Items ─────────────────────

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
  v_root_creator uuid;
  v_first_by uuid;
  v_first_at timestamptz;
  v_unit record;
  v_lesson record;
  v_item record;
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

  v_root_id := coalesce(v_src.original_content_id, v_src.id);
  v_root_owner := coalesce(v_src.original_owner_id, v_src.owner_id);
  v_root_creator := coalesce(v_src.original_creator_id, v_src.original_owner_id, v_src.owner_id);
  v_first_by := v_src.first_community_published_by_id;
  v_first_at := v_src.first_community_published_at;

  if v_root_id is distinct from v_src.id then
    declare
      v_rf_by uuid;
      v_rf_at timestamptz;
      v_rc uuid;
      v_ro uuid;
      v_rown uuid;
    begin
      select
        lc.first_community_published_by_id,
        lc.first_community_published_at,
        lc.original_creator_id,
        lc.original_owner_id,
        lc.owner_id
      into v_rf_by, v_rf_at, v_rc, v_ro, v_rown
      from public.learning_contents lc
      where lc.id = v_root_id;

      if found then
        if v_first_by is null then
          v_first_by := v_rf_by;
          v_first_at := v_rf_at;
        end if;
        v_root_creator := coalesce(v_root_creator, v_rc, v_ro, v_rown);
      end if;
    end;
  end if;

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
    preparation_status,
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
    original_owner_id,
    original_creator_id,
    first_community_published_by_id,
    first_community_published_at
  ) values (
    v_uid,
    v_title,
    v_src.description,
    'draft',
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
    v_root_owner,
    v_root_creator,
    v_first_by,
    v_first_at
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
      order by position asc, created_at asc, id asc
    loop
      insert into public.content_lessons (
        unit_id,
        title,
        description,
        position,
        document_json,
        document_version,
        estimated_minutes
      ) values (
        v_new_unit_id,
        v_lesson.title,
        v_lesson.description,
        v_lesson.position,
        coalesce(v_lesson.document_json, '[]'::jsonb),
        coalesce(v_lesson.document_version, 1),
        v_lesson.estimated_minutes
      )
      returning id into v_new_lesson_id;

      for v_item in
        select *
        from public.content_items
        where lesson_id = v_lesson.id
        order by position asc, created_at asc, id asc
      loop
        insert into public.content_items (
          lesson_id,
          type,
          title,
          position,
          content,
          config
        ) values (
          v_new_lesson_id,
          v_item.type,
          v_item.title,
          v_item.position,
          coalesce(v_item.content, '{}'::jsonb),
          coalesce(v_item.config, '{}'::jsonb)
        );
      end loop;

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
  'Deep-copies readable learning_content: Content -> Units -> Lessons -> Items (new IDs). Provenance content-level only. Progress not copied.';

-- Drop helper used only during row migration (safe to keep map function)
drop function if exists public.content_item_config_from_lesson_row(public.content_lessons);
