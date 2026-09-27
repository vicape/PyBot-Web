-- Content V3 structure foundation (additive / backwards-compatible).
-- Physical table content_lessons remains; rows are Content V3 learning items.
-- Hierarchy stays: learning_contents -> content_units -> content_lessons.
-- Bounded depth: Unit -> Lesson -> Item  OR  Unit -> Item. No arbitrary nesting.
--
-- EXECUTION ENVIRONMENT: CLOUD via MaxCloud only
-- BASELINE: ba552fd501b1916af52d14f90b2213338056e740
-- URL compatibility (unchanged): /dashboard/content/:contentId/lessons/:lessonId
-- DO NOT change learning_contents.status; visibility private|courses|community unchanged.
-- activities.content_snapshot and activities.content_source_id remain untouched.
-- activities.content_source_type allowed: content|unit|lesson|exercise|task (+ 'item').
-- activities.activity_kind unchanged: material|exercise|task
-- Every content_lessons row keeps unit_id NOT NULL.
-- Hierarchy invariants when parent_lesson_id IS NOT NULL:
--   child.unit_id must equal parent.unit_id; child.item_type must NOT be 'lesson'.
-- Constraint prevents parent_lesson_id = id (self-parent).
-- FK parent_lesson_id -> public.content_lessons(id) ON DELETE CASCADE.
-- PRESERVE COMPLETELY: current Content UI; BlockNote editor; viewer; mobile typography;
-- desktop typography; Library UI; Community; copy provenance; current assignment flows;
-- current activity flows; current submissions; current progress; Google Classroom;
-- authentication; courses; IDE; ESP32; EDA6; hardware; telemetry.

-- ── content_lessons: parent_lesson_id (bounded hierarchy) ───────────────────

alter table public.content_lessons
  add column if not exists parent_lesson_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_lessons_parent_lesson_id_fkey'
  ) then
    alter table public.content_lessons
      add constraint content_lessons_parent_lesson_id_fkey
      foreign key (parent_lesson_id)
      references public.content_lessons(id)
      on delete cascade;
  end if;
end $$;

-- Prevent self-parent: parent_lesson_id = id is rejected (CHECK + trigger).
alter table public.content_lessons
  drop constraint if exists content_lessons_parent_not_self_check;
alter table public.content_lessons
  add constraint content_lessons_parent_not_self_check
  check (parent_lesson_id is distinct from id); -- forbids parent_lesson_id = id

-- Backfill: ADD COLUMN leaves every existing row with parent_lesson_id = NULL
-- (top-level Unit children). Do not UPDATE null on re-apply (would wipe nested items).

comment on column public.content_lessons.parent_lesson_id is
  'NULL = item directly under a Unit; NOT NULL = item inside a Lesson container. Bounded: Unit->Lesson->Item or Unit->Item only.';

comment on table public.content_lessons is
  'Content V3 learning items (backward-compatible physical name). Rows may be Lesson containers or leaf items (reading/video/exercise/quiz/assignment/resource/project/legacy).';

-- ── content_lessons: completion / grading configuration (schema only) ───────

-- required boolean NOT NULL DEFAULT true
-- completion_rule text NOT NULL DEFAULT 'none'
-- grading_mode text NOT NULL DEFAULT 'none'
-- learning_objectives text[] NOT NULL DEFAULT '{}'
alter table public.content_lessons
  add column if not exists required boolean NOT NULL DEFAULT true,
  add column if not exists completion_rule text NOT NULL DEFAULT 'none',
  add column if not exists grading_mode text NOT NULL DEFAULT 'none',
  add column if not exists passing_score numeric null,
  add column if not exists completion_threshold numeric null,
  add column if not exists learning_objectives text[] NOT NULL DEFAULT '{}';

alter table public.content_lessons
  drop constraint if exists content_lessons_completion_rule_check;
alter table public.content_lessons
  add constraint content_lessons_completion_rule_check
  check (
    completion_rule in (
      'none',
      'marked_complete',
      'viewed',
      'video_threshold',
      'submitted',
      'quiz_finished'
    )
  );

alter table public.content_lessons
  drop constraint if exists content_lessons_grading_mode_check;
alter table public.content_lessons
  add constraint content_lessons_grading_mode_check
  check (grading_mode in ('none', 'automatic', 'teacher'));

alter table public.content_lessons
  drop constraint if exists content_lessons_passing_score_check;
alter table public.content_lessons
  add constraint content_lessons_passing_score_check
  check (passing_score is null or (passing_score >= 0 and passing_score <= 100));

alter table public.content_lessons
  drop constraint if exists content_lessons_completion_threshold_check;
alter table public.content_lessons
  add constraint content_lessons_completion_threshold_check
  check (
    completion_threshold is null
    or (completion_threshold >= 0 and completion_threshold <= 1)
  );

comment on column public.content_lessons.required is
  'Configuration only: whether this item is required for derived Unit/Lesson completion. Containers are not extra required items beyond descendants.';
comment on column public.content_lessons.completion_rule is
  'Configuration only (none|marked_complete|viewed|video_threshold|submitted|quiz_finished). No student tracking yet.';
comment on column public.content_lessons.grading_mode is
  'Configuration only (none|automatic|teacher). completed and passed remain separate concepts; no grading logic yet.';
comment on column public.content_lessons.completion_threshold is
  'Configuration only: null or 0..1 inclusive (e.g. video progress). No runtime tracking yet.';
comment on column public.content_lessons.passing_score is
  'Configuration only: null or 0..100 inclusive. Pass is distinct from complete; no scoring logic yet.';

-- ── item_type: preserve legacy + extend V3 types ────────────────────────────

alter table public.content_lessons
  drop constraint if exists content_lessons_item_type_check;
alter table public.content_lessons
  add constraint content_lessons_item_type_check
  check (
    item_type in (
      'lesson',
      'theory',
      'example',
      'activity',
      'exercise',
      'quiz',
      'test',
      'project',
      'resource',
      'reading',
      'video',
      'assignment'
    )
  );

comment on column public.content_lessons.item_type is
  'Content V3 item type. Preferred: lesson|reading|video|exercise|quiz|assignment|resource|project. Legacy theory|example|activity|test retained.';

-- ── Indexes for sibling ordering (no UNIQUE on position) ────────────────────

create index if not exists content_lessons_parent_position_idx
  on public.content_lessons (parent_lesson_id, position);

create index if not exists content_lessons_unit_parent_position_idx
  on public.content_lessons (unit_id, parent_lesson_id, position);

-- ── Hierarchy validation (fail-closed) ──────────────────────────────────────

create or replace function public.content_lessons_validate_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.content_lessons%rowtype;
begin
  -- Self-parent also covered by CHECK; fail-closed here too
  if new.parent_lesson_id is not null and new.parent_lesson_id = new.id then
    raise exception 'invalid_hierarchy: self_parent';
  end if;

  -- Rows that already own children must remain top-level lesson containers
  if tg_op = 'UPDATE' then
    if exists (
      select 1 from public.content_lessons c where c.parent_lesson_id = new.id
    ) then
      if new.item_type is distinct from 'lesson' or new.parent_lesson_id is not null then
        raise exception 'invalid_hierarchy: container_with_children';
      end if;
    end if;
  end if;

  if new.parent_lesson_id is null then
    return new;
  end if;

  select * into v_parent
  from public.content_lessons
  where id = new.parent_lesson_id;

  if not found then
    raise exception 'invalid_hierarchy: parent_missing';
  end if;

  if v_parent.item_type is distinct from 'lesson' then
    raise exception 'invalid_hierarchy: parent_not_lesson';
  end if;

  if v_parent.parent_lesson_id is not null then
    raise exception 'invalid_hierarchy: parent_is_nested';
  end if;

  -- child.unit_id must equal parent.unit_id
  if new.unit_id is distinct from v_parent.unit_id then
    raise exception 'invalid_hierarchy: unit_mismatch';
  end if;

  -- child.item_type must NOT be 'lesson'
  if new.item_type = 'lesson' then
    raise exception 'invalid_hierarchy: lesson_under_lesson';
  end if;

  return new;
end;
$$;

drop trigger if exists content_lessons_validate_hierarchy_trg on public.content_lessons;
create trigger content_lessons_validate_hierarchy_trg
  before insert or update on public.content_lessons
  for each row
  execute function public.content_lessons_validate_hierarchy();

comment on function public.content_lessons_validate_hierarchy() is
  'Fail-closed Content V3 hierarchy: Lesson may own one level of non-lesson items; Unit may own lesson or leaf items; no lesson->lesson, item->child, or unit_id mismatch. Requires unit_id NOT NULL; when nested: child.unit_id = parent.unit_id and child.item_type <> lesson; rejects parent_lesson_id = id.';

-- ── Move: propagate unit_id to direct children of a top-level Lesson ────────

create or replace function public.content_lessons_propagate_unit_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.parent_lesson_id is null
     and new.unit_id is distinct from old.unit_id then
    update public.content_lessons
    set unit_id = new.unit_id,
        updated_at = now()
    where parent_lesson_id = new.id
      and unit_id is distinct from new.unit_id;
  end if;
  return new;
end;
$$;

drop trigger if exists content_lessons_propagate_unit_id_trg on public.content_lessons;
create trigger content_lessons_propagate_unit_id_trg
  after update of unit_id on public.content_lessons
  for each row
  execute function public.content_lessons_propagate_unit_id();

comment on function public.content_lessons_propagate_unit_id() is
  'When a top-level Lesson moves between Units, atomically update direct children unit_id without changing child IDs or parent_lesson_id.';

-- ── learning_contents: preparation_status (independent of visibility) ───────
-- DO NOT remove/change learning_contents.status (app depends on it).
-- preparation_status text NOT NULL DEFAULT 'draft'
-- Backfill: status = 'published' -> preparation_status = 'ready'; otherwise 'draft'.

alter table public.learning_contents
  add column if not exists preparation_status text NOT NULL DEFAULT 'draft';

alter table public.learning_contents
  drop constraint if exists learning_contents_preparation_status_check;
alter table public.learning_contents
  add constraint learning_contents_preparation_status_check
  check (preparation_status in ('draft', 'ready'));

-- Backfill: published -> preparation_status = 'ready'; otherwise draft (already default)
update public.learning_contents
set preparation_status = case
  when status = 'published' then 'ready'
  else 'draft'
end
where preparation_status is distinct from case
  when status = 'published' then 'ready'
  else 'draft'
end;

comment on column public.learning_contents.preparation_status is
  'preparation_status text NOT NULL DEFAULT ''draft''. Independent of visibility (private|courses|community). draft|ready. Legacy learning_contents.status = published backfilled to preparation_status = ''ready''; learning_contents.status unchanged.';

-- ── activities.content_source_type: add 'item' (preserve existing values) ────
-- Preserve activities.content_snapshot, activities.content_source_id, activities.activity_kind.
-- Existing content_source_type values remain: content|unit|lesson|exercise|task
-- Existing activity_kind values remain: material|exercise|task

alter table public.activities
  drop constraint if exists activities_content_source_type_check;
alter table public.activities
  add constraint activities_content_source_type_check
  check (
    content_source_type is null
    or content_source_type in (
      'content',
      'unit',
      'lesson',
      'exercise',
      'task',
      'item'
    )
  );

-- ── Deep copy RPC: hierarchy + new item configuration fields ────────────────

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
  v_block record;
  v_new_unit_id uuid;
  v_new_lesson_id uuid;
  v_new_parent_id uuid;
  v_title text;
  v_id_map jsonb := '{}'::jsonb;
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

    -- Pass 1: top-level items (parent_lesson_id IS NULL)
    for v_lesson in
      select *
      from public.content_lessons
      where unit_id = v_unit.id
        and parent_lesson_id is null
      order by position asc, created_at asc, id asc
    loop
      insert into public.content_lessons (
        unit_id,
        parent_lesson_id,
        title,
        description,
        position,
        document_json,
        document_version,
        item_type,
        estimated_minutes,
        required,
        completion_rule,
        completion_threshold,
        grading_mode,
        passing_score,
        learning_objectives
      ) values (
        v_new_unit_id,
        null,
        v_lesson.title,
        v_lesson.description,
        v_lesson.position,
        v_lesson.document_json,
        coalesce(v_lesson.document_version, 1),
        coalesce(nullif(v_lesson.item_type, ''), 'lesson'),
        v_lesson.estimated_minutes,
        coalesce(v_lesson.required, true),
        coalesce(nullif(v_lesson.completion_rule, ''), 'none'),
        v_lesson.completion_threshold,
        coalesce(nullif(v_lesson.grading_mode, ''), 'none'),
        v_lesson.passing_score,
        coalesce(v_lesson.learning_objectives, '{}'::text[])
      )
      returning id into v_new_lesson_id;

      v_id_map := v_id_map || jsonb_build_object(v_lesson.id::text, v_new_lesson_id::text);

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

    -- Pass 2: lesson child items (map parent_lesson_id -> NEW parent id)
    for v_lesson in
      select *
      from public.content_lessons
      where unit_id = v_unit.id
        and parent_lesson_id is not null
      order by position asc, created_at asc, id asc
    loop
      v_new_parent_id := (v_id_map ->> v_lesson.parent_lesson_id::text)::uuid;

      if v_new_parent_id is null then
        raise exception 'copy_failed: missing_parent_map';
      end if;

      insert into public.content_lessons (
        unit_id,
        parent_lesson_id,
        title,
        description,
        position,
        document_json,
        document_version,
        item_type,
        estimated_minutes,
        required,
        completion_rule,
        completion_threshold,
        grading_mode,
        passing_score,
        learning_objectives
      ) values (
        v_new_unit_id,
        v_new_parent_id,
        v_lesson.title,
        v_lesson.description,
        v_lesson.position,
        v_lesson.document_json,
        coalesce(v_lesson.document_version, 1),
        coalesce(nullif(v_lesson.item_type, ''), 'lesson'),
        v_lesson.estimated_minutes,
        coalesce(v_lesson.required, true),
        coalesce(nullif(v_lesson.completion_rule, ''), 'none'),
        v_lesson.completion_threshold,
        coalesce(nullif(v_lesson.grading_mode, ''), 'none'),
        v_lesson.passing_score,
        coalesce(v_lesson.learning_objectives, '{}'::text[])
      )
      returning id into v_new_lesson_id;

      v_id_map := v_id_map || jsonb_build_object(v_lesson.id::text, v_new_lesson_id::text);

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
  'Deep-copies readable learning_content including Content V3 hierarchy (top-level + lesson children). New IDs; child parent_lesson_id maps to copied parent. Provenance content-level only. Progress not copied.';
