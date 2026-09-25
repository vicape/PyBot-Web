-- Content lineage provenance: original creator + first Community publisher.
-- Additive / backwards-compatible. Does not fabricate historical Community publishers.
-- Ownership / edit / delete / share / assign permissions unchanged.

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table public.learning_contents
  add column if not exists original_creator_id uuid,
  add column if not exists first_community_published_by_id uuid,
  add column if not exists first_community_published_at timestamptz;

-- FKs: deleting a profile/user must NOT delete learning content
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_contents_original_creator_id_fkey'
  ) then
    alter table public.learning_contents
      add constraint learning_contents_original_creator_id_fkey
      foreign key (original_creator_id)
      references auth.users (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_contents_first_community_published_by_id_fkey'
  ) then
    alter table public.learning_contents
      add constraint learning_contents_first_community_published_by_id_fkey
      foreign key (first_community_published_by_id)
      references auth.users (id)
      on delete set null;
  end if;
end $$;

create index if not exists learning_contents_original_creator_idx
  on public.learning_contents (original_creator_id)
  where original_creator_id is not null;

create index if not exists learning_contents_first_community_publisher_idx
  on public.learning_contents (first_community_published_by_id)
  where first_community_published_by_id is not null;

comment on column public.learning_contents.original_creator_id is
  'Root human creator of the material lineage. Immutable after set. Distinct from owner_id.';
comment on column public.learning_contents.first_community_published_by_id is
  'First known user who published this lineage into PyBot Community. Immutable once set.';
comment on column public.learning_contents.first_community_published_at is
  'Timestamp of first known Community publication for this lineage. Immutable once set.';

-- ── Legacy backfill (deterministic only) ────────────────────────────────────
-- Inspection: copy RPC sets original_owner_id = coalesce(src.original_owner_id, src.owner_id)
--   = root owner of the lineage. No ownership-transfer path exists (RLS update with check
--   owner_id = auth.uid() prevents transferring owner_id). Therefore:
--   - copies: original_owner_id is a proven root-owner / creator proxy
--   - non-copies: owner_id is the creator of that original record
-- first_community_*: intentionally NOT backfilled (no reliable historical evidence).

update public.learning_contents
set original_creator_id = original_owner_id
where original_creator_id is null
  and original_owner_id is not null;

update public.learning_contents
set original_creator_id = owner_id
where original_creator_id is null
  and original_owner_id is null
  and copied_from_content_id is null
  and original_content_id is null;

-- ── Provenance guard (anti-forgery + first Community capture) ───────────────

create or replace function public.learning_contents_guard_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_copying text;
  v_propagating text;
  v_root_id uuid;
  v_lineage_by uuid;
  v_lineage_at timestamptz;
begin
  begin
    v_copying := current_setting('pybot.copying_content', true);
  exception when others then
    v_copying := null;
  end;

  begin
    v_propagating := current_setting('pybot.propagating_lineage_provenance', true);
  exception when others then
    v_propagating := null;
  end;

  if coalesce(v_copying, '') = '1' then
    return new;
  end if;

  -- Trusted lineage sync onto root (from AFTER trigger); allow first_* through when old null
  if coalesce(v_propagating, '') = '1' then
    if tg_op = 'UPDATE' then
      new.copied_from_content_id := old.copied_from_content_id;
      new.original_content_id := old.original_content_id;
      new.original_owner_id := old.original_owner_id;
      new.original_creator_id := old.original_creator_id;
      if old.first_community_published_by_id is not null then
        new.first_community_published_by_id := old.first_community_published_by_id;
        new.first_community_published_at := old.first_community_published_at;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Client cannot forge lineage / first-publish; creator is always the inserting user
    new.copied_from_content_id := null;
    new.original_content_id := null;
    new.original_owner_id := null;
    new.original_creator_id := auth.uid();
    new.first_community_published_by_id := null;
    new.first_community_published_at := null;
  elsif tg_op = 'UPDATE' then
    new.copied_from_content_id := old.copied_from_content_id;
    new.original_content_id := old.original_content_id;
    new.original_owner_id := old.original_owner_id;
    new.original_creator_id := old.original_creator_id;

    -- first_community_*: immutable once set
    if old.first_community_published_by_id is not null then
      new.first_community_published_by_id := old.first_community_published_by_id;
      new.first_community_published_at := old.first_community_published_at;
    elsif new.visibility = 'community'
      and old.visibility is distinct from 'community' then
      -- Lineage-level: prefer root's known first publisher over "publisher of this copy"
      v_root_id := coalesce(old.original_content_id, new.id);
      v_lineage_by := null;
      v_lineage_at := null;
      if v_root_id is distinct from new.id then
        select lc.first_community_published_by_id, lc.first_community_published_at
          into v_lineage_by, v_lineage_at
        from public.learning_contents lc
        where lc.id = v_root_id;
      end if;

      if v_lineage_by is not null then
        new.first_community_published_by_id := v_lineage_by;
        new.first_community_published_at := v_lineage_at;
      else
        new.first_community_published_by_id := auth.uid();
        new.first_community_published_at := now();
      end if;
    else
      -- Strip client forgery; do not invent history for already-community legacy rows
      new.first_community_published_by_id := null;
      new.first_community_published_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists learning_contents_guard_provenance_trg on public.learning_contents;
create trigger learning_contents_guard_provenance_trg
  before insert or update on public.learning_contents
  for each row
  execute function public.learning_contents_guard_provenance();

-- Propagate first Community provenance onto the lineage root when a copy publishes first
create or replace function public.learning_contents_propagate_lineage_first_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root_id uuid;
begin
  if new.first_community_published_by_id is null then
    return new;
  end if;
  if new.visibility is distinct from 'community' then
    return new;
  end if;
  if old.visibility is not distinct from 'community' then
    return new;
  end if;

  v_root_id := coalesce(new.original_content_id, new.id);
  if v_root_id is not distinct from new.id then
    return new;
  end if;

  perform set_config('pybot.propagating_lineage_provenance', '1', true);
  update public.learning_contents
  set
    first_community_published_by_id = new.first_community_published_by_id,
    first_community_published_at = new.first_community_published_at
  where id = v_root_id
    and first_community_published_by_id is null;
  perform set_config('pybot.propagating_lineage_provenance', '', true);

  return new;
exception
  when others then
    perform set_config('pybot.propagating_lineage_provenance', '', true);
    raise;
end;
$$;

drop trigger if exists learning_contents_propagate_lineage_first_community_trg
  on public.learning_contents;
create trigger learning_contents_propagate_lineage_first_community_trg
  after update of visibility on public.learning_contents
  for each row
  execute function public.learning_contents_propagate_lineage_first_community();

-- ── Copy RPC: preserve full provenance lineage ──────────────────────────────

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
  v_root_creator := coalesce(v_src.original_creator_id, v_src.original_owner_id, v_src.owner_id);
  v_first_by := v_src.first_community_published_by_id;
  v_first_at := v_src.first_community_published_at;

  -- Prefer lineage-root first Community provenance / creator when source row lacks them
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
  'Deep-copies readable learning_content for the caller. Provenance: copied_from, original_content_id, original_owner_id, original_creator_id, first_community_published_*. Media blobs are not duplicated.';
