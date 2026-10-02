-- Point 9: Generic multidimensional rubrics (evolve existing rubric system).
-- Baseline confirmado exactamente d445346664a87e4621455036455d5d79190ea540
-- Forward-only. DO NOT edit 20260915200046_pybotclass_workflow_rubrics.sql
-- nor any P1–P8 historical migration.
-- File exactly: supabase/migrations/20261002160000_p9_generic_multidimensional_rubrics.sql
-- DO NOT apply from Cloud Cursor; MaxBase applies this exact file.
--
-- Model: rubric -> criteria -> achievement levels
-- Modes: exactly one of qualitative | points
-- Templates (mutable) -> immutable activity rubric snapshot
-- Evaluation tied to exact activity_submissions.id (V1/V2 independent)
-- Teacher drafts: separate table, teacher-only, no graded side-effects
--
-- P9 closure path exactly: activity -> activity_submission -> rubric evaluation
-- Official numeric grade remains activity_submissions.grade
-- Qualitative: must never invent grade=0 or 0%; activity_submissions.grade may stay null
-- Points mode: maximum obtainable rubric total coherent with activities.max_points
-- CASE E: selected levels worth 4 + 3 + 5 yield server total 12; P6 consumes 12/max_points once
-- Preserve activity_item_submissions for embedded items; no second rubric engine for them
-- No unresolved DECISION REQUIRED: product rules above are resolved in this forward migration

-- ── Reusable teacher rubric templates ────────────────────────────────────────

create table if not exists public.rubric_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  scoring_mode text not null check (scoring_mode in ('qualitative', 'points')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rubric_templates_owner_idx
  on public.rubric_templates (owner_id, updated_at desc);

create table if not exists public.rubric_template_criteria (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.rubric_templates (id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rubric_template_criteria_template_idx
  on public.rubric_template_criteria (template_id, sort_order);

create table if not exists public.rubric_template_levels (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references public.rubric_template_criteria (id) on delete cascade,
  name text not null,
  descriptor text,
  sort_order int not null default 0,
  points numeric check (points is null or points >= 0),
  created_at timestamptz not null default now()
);

create index if not exists rubric_template_levels_criterion_idx
  on public.rubric_template_levels (criterion_id, sort_order);

alter table public.rubric_templates enable row level security;
alter table public.rubric_template_criteria enable row level security;
alter table public.rubric_template_levels enable row level security;

drop policy if exists rt_select_own on public.rubric_templates;
create policy rt_select_own on public.rubric_templates
  for select using (owner_id = auth.uid() or public.is_super_admin());

drop policy if exists rt_write_own on public.rubric_templates;
create policy rt_write_own on public.rubric_templates
  for all using (owner_id = auth.uid() or public.is_super_admin())
  with check (owner_id = auth.uid() or public.is_super_admin());

drop policy if exists rtc_select_own on public.rubric_template_criteria;
create policy rtc_select_own on public.rubric_template_criteria
  for select using (
    exists (
      select 1 from public.rubric_templates t
      where t.id = rubric_template_criteria.template_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  );

drop policy if exists rtc_write_own on public.rubric_template_criteria;
create policy rtc_write_own on public.rubric_template_criteria
  for all using (
    exists (
      select 1 from public.rubric_templates t
      where t.id = rubric_template_criteria.template_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1 from public.rubric_templates t
      where t.id = rubric_template_criteria.template_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  );

drop policy if exists rtl_select_own on public.rubric_template_levels;
create policy rtl_select_own on public.rubric_template_levels
  for select using (
    exists (
      select 1
      from public.rubric_template_criteria c
      join public.rubric_templates t on t.id = c.template_id
      where c.id = rubric_template_levels.criterion_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  );

drop policy if exists rtl_write_own on public.rubric_template_levels;
create policy rtl_write_own on public.rubric_template_levels
  for all using (
    exists (
      select 1
      from public.rubric_template_criteria c
      join public.rubric_templates t on t.id = c.template_id
      where c.id = rubric_template_levels.criterion_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1
      from public.rubric_template_criteria c
      join public.rubric_templates t on t.id = c.template_id
      where c.id = rubric_template_levels.criterion_id
        and (t.owner_id = auth.uid() or public.is_super_admin())
    )
  );

-- ── Evolve frozen activity rubric ────────────────────────────────────────────

alter table public.activity_rubrics
  add column if not exists scoring_mode text;

alter table public.activity_rubrics
  add column if not exists source_template_id uuid references public.rubric_templates (id) on delete set null;

alter table public.activity_rubrics
  add column if not exists frozen_at timestamptz;

alter table public.activity_rubrics
  add column if not exists schema_generation int;

update public.activity_rubrics
set
  scoring_mode = coalesce(scoring_mode, 'points'),
  schema_generation = coalesce(schema_generation, 1),
  frozen_at = coalesce(frozen_at, created_at, now())
where scoring_mode is null
   or schema_generation is null
   or frozen_at is null;

alter table public.activity_rubrics
  alter column scoring_mode set default 'points';

alter table public.activity_rubrics
  alter column schema_generation set default 1;

alter table public.activity_rubrics
  alter column frozen_at set default now();

alter table public.activity_rubrics
  alter column scoring_mode set not null;

alter table public.activity_rubrics
  alter column schema_generation set not null;

alter table public.activity_rubrics
  alter column frozen_at set not null;

alter table public.activity_rubrics
  drop constraint if exists activity_rubrics_scoring_mode_check;

alter table public.activity_rubrics
  add constraint activity_rubrics_scoring_mode_check
  check (scoring_mode in ('qualitative', 'points'));

alter table public.activity_rubrics
  drop constraint if exists activity_rubrics_schema_generation_check;

alter table public.activity_rubrics
  add constraint activity_rubrics_schema_generation_check
  check (schema_generation in (1, 2));

-- Legacy criteria keep max_points; qualitative P9 may leave null.
alter table public.activity_rubric_criteria
  drop constraint if exists activity_rubric_criteria_max_points_check;

alter table public.activity_rubric_criteria
  alter column max_points drop not null;

alter table public.activity_rubric_criteria
  add constraint activity_rubric_criteria_max_points_check
  check (max_points is null or max_points > 0);

create table if not exists public.activity_rubric_levels (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references public.activity_rubric_criteria (id) on delete cascade,
  name text not null,
  descriptor text,
  sort_order int not null default 0,
  points numeric check (points is null or points >= 0),
  created_at timestamptz not null default now()
);

create index if not exists activity_rubric_levels_criterion_idx
  on public.activity_rubric_levels (criterion_id, sort_order);

alter table public.activity_rubric_levels enable row level security;

drop policy if exists arl_select on public.activity_rubric_levels;
create policy arl_select on public.activity_rubric_levels
  for select using (
    exists (
      select 1
      from public.activity_rubric_criteria c
      join public.activity_rubrics r on r.id = c.rubric_id
      where c.id = activity_rubric_levels.criterion_id
        and (
          public.activity_visible_to_me(r.activity_id)
          or exists (
            select 1 from public.activities a
            where a.id = r.activity_id
              and public.is_course_teacher(a.course_id)
          )
          or public.is_super_admin()
        )
    )
  );

drop policy if exists arl_teacher_write on public.activity_rubric_levels;
create policy arl_teacher_write on public.activity_rubric_levels
  for all using (
    exists (
      select 1
      from public.activity_rubric_criteria c
      join public.activity_rubrics r on r.id = c.rubric_id
      join public.activities a on a.id = r.activity_id
      where c.id = activity_rubric_levels.criterion_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1
      from public.activity_rubric_criteria c
      join public.activity_rubrics r on r.id = c.rubric_id
      join public.activities a on a.id = r.activity_id
      where c.id = activity_rubric_levels.criterion_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

-- ── Evaluation scores: frozen level evidence + nullable points ───────────────

alter table public.activity_submission_rubric_scores
  add column if not exists level_id uuid;

alter table public.activity_submission_rubric_scores
  add column if not exists level_name text;

alter table public.activity_submission_rubric_scores
  add column if not exists level_descriptor text;

-- Drop NOT NULL on points for qualitative evaluations.
alter table public.activity_submission_rubric_scores
  alter column points drop not null;

alter table public.activity_submission_rubric_scores
  drop constraint if exists activity_submission_rubric_scores_points_check;

alter table public.activity_submission_rubric_scores
  add constraint activity_submission_rubric_scores_points_check
  check (points is null or points >= 0);

-- Prevent cascade-delete of historical scores when criteria are removed.
do $$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  where rel.relname = 'activity_submission_rubric_scores'
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%criterion_id%';
  if v_con is not null then
    execute format('alter table public.activity_submission_rubric_scores drop constraint %I', v_con);
  end if;
end $$;

alter table public.activity_submission_rubric_scores
  add constraint activity_submission_rubric_scores_criterion_id_fkey
  foreign key (criterion_id) references public.activity_rubric_criteria (id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activity_submission_rubric_scores_level_id_fkey'
  ) then
    alter table public.activity_submission_rubric_scores
      add constraint activity_submission_rubric_scores_level_id_fkey
      foreign key (level_id) references public.activity_rubric_levels (id) on delete set null;
  end if;
end $$;

-- ── Teacher-only grading drafts (no graded / P4 / P5 / P6 side effects) ───────

create table if not exists public.activity_submission_rubric_drafts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.activity_submissions (id) on delete cascade,
  criterion_id uuid not null references public.activity_rubric_criteria (id) on delete cascade,
  level_id uuid references public.activity_rubric_levels (id) on delete set null,
  points numeric check (points is null or points >= 0),
  comment text,
  updated_at timestamptz not null default now(),
  unique (submission_id, criterion_id)
);

create index if not exists activity_submission_rubric_drafts_sub_idx
  on public.activity_submission_rubric_drafts (submission_id);

alter table public.activity_submission_rubric_drafts enable row level security;

drop policy if exists asrd_teacher_select on public.activity_submission_rubric_drafts;
create policy asrd_teacher_select on public.activity_submission_rubric_drafts
  for select using (
    exists (
      select 1
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_drafts.submission_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

drop policy if exists asrd_teacher_write on public.activity_submission_rubric_drafts;
create policy asrd_teacher_write on public.activity_submission_rubric_drafts
  for all using (
    exists (
      select 1
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_drafts.submission_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  )
  with check (
    exists (
      select 1
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_drafts.submission_id
        and (public.is_course_teacher(a.course_id) or public.is_super_admin())
    )
  );

-- Students must not read drafts (no student policy). Tighten published score select:
-- students only see own scores when submission is graded/closed.
drop policy if exists asrs_select on public.activity_submission_rubric_scores;
create policy asrs_select on public.activity_submission_rubric_scores
  for select using (
    exists (
      select 1
      from public.activity_submissions s
      join public.activities a on a.id = s.activity_id
      where s.id = activity_submission_rubric_scores.submission_id
        and (
          public.is_course_teacher(a.course_id)
          or public.is_super_admin()
          or (
            s.user_id = auth.uid()
            and s.status in ('graded', 'closed')
          )
        )
    )
  );

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.activity_rubric_has_evaluations(p_rubric_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.activity_submission_rubric_scores s
    join public.activity_rubric_criteria c on c.id = s.criterion_id
    where c.rubric_id = p_rubric_id
  );
$$;

create or replace function public.rubric_criterion_points_ceiling(p_criterion_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select max(l.points)
      from public.activity_rubric_levels l
      where l.criterion_id = p_criterion_id
        and l.points is not null
    ),
    (
      select c.max_points
      from public.activity_rubric_criteria c
      where c.id = p_criterion_id
    )
  );
$$;

-- ── Template upsert (owner = auth.uid()) ─────────────────────────────────────

create or replace function public.upsert_rubric_template(
  p_template_id uuid,
  p_name text,
  p_description text,
  p_scoring_mode text,
  p_criteria jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_mode text;
  v_elem jsonb;
  v_level jsonb;
  v_idx int := 0;
  v_lidx int;
  v_name text;
  v_desc text;
  v_crit_id uuid;
  v_level_name text;
  v_descriptor text;
  v_points numeric;
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  v_mode := lower(trim(coalesce(p_scoring_mode, '')));
  if v_mode not in ('qualitative', 'points') then
    return jsonb_build_object('ok', false, 'error', 'scoring_mode_required');
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'rubric_name_required');
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) < 1 then
    return jsonb_build_object('ok', false, 'error', 'criteria_required');
  end if;

  if p_template_id is not null then
    select owner_id into v_owner from public.rubric_templates where id = p_template_id;
    if v_owner is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_owner <> v_uid and not coalesce(public.is_super_admin(), false) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    update public.rubric_templates
    set name = v_name,
        description = nullif(trim(coalesce(p_description, '')), ''),
        scoring_mode = v_mode,
        updated_at = now()
    where id = p_template_id;
    v_id := p_template_id;
    delete from public.rubric_template_criteria where template_id = v_id;
  else
    insert into public.rubric_templates (owner_id, name, description, scoring_mode, updated_at)
    values (v_uid, v_name, nullif(trim(coalesce(p_description, '')), ''), v_mode, now())
    returning id into v_id;
  end if;

  for v_elem in select * from jsonb_array_elements(p_criteria)
  loop
    v_name := nullif(trim(coalesce(v_elem->>'name', '')), '');
    v_desc := nullif(trim(coalesce(v_elem->>'description', '')), '');
    if v_name is null then
      return jsonb_build_object('ok', false, 'error', 'criterion_name_required');
    end if;
    if v_elem->'levels' is null or jsonb_typeof(v_elem->'levels') <> 'array'
       or jsonb_array_length(v_elem->'levels') < 1 then
      return jsonb_build_object('ok', false, 'error', 'levels_required');
    end if;

    insert into public.rubric_template_criteria (template_id, name, description, sort_order)
    values (v_id, v_name, v_desc, v_idx)
    returning id into v_crit_id;

    v_lidx := 0;
    for v_level in select * from jsonb_array_elements(v_elem->'levels')
    loop
      v_level_name := nullif(trim(coalesce(v_level->>'name', '')), '');
      v_descriptor := nullif(trim(coalesce(v_level->>'descriptor', coalesce(v_level->>'description', ''))), '');
      if v_level_name is null then
        return jsonb_build_object('ok', false, 'error', 'level_name_required');
      end if;
      v_points := null;
      if v_mode = 'points' then
        begin
          v_points := (v_level->>'points')::numeric;
        exception when others then
          return jsonb_build_object('ok', false, 'error', 'invalid_level_points');
        end;
        if v_points is null or v_points < 0 then
          return jsonb_build_object('ok', false, 'error', 'level_points_required');
        end if;
      end if;
      insert into public.rubric_template_levels (
        criterion_id, name, descriptor, sort_order, points
      ) values (
        v_crit_id, v_level_name, v_descriptor, v_lidx, v_points
      );
      v_lidx := v_lidx + 1;
    end loop;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'template_id', v_id);
end;
$$;

grant execute on function public.upsert_rubric_template(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.delete_rubric_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  select owner_id into v_owner from public.rubric_templates where id = p_template_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_owner <> v_uid and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Activity snapshots keep source_template_id via ON DELETE SET NULL;
  -- frozen criteria/levels/evaluations remain intact.
  delete from public.rubric_templates where id = p_template_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.delete_rubric_template(uuid) to authenticated;

create or replace function public.list_my_rubric_templates()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  return jsonb_build_object(
    'ok', true,
    'templates', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.updated_at desc)
      from public.rubric_templates t
      where t.owner_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.list_my_rubric_templates() to authenticated;

create or replace function public.get_rubric_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.rubric_templates%rowtype;
  v_criteria jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  select * into v_row from public.rubric_templates where id = p_template_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.owner_id <> v_uid and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'sort_order', c.sort_order,
      'levels', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'name', l.name,
            'descriptor', l.descriptor,
            'sort_order', l.sort_order,
            'points', l.points
          ) order by l.sort_order
        )
        from public.rubric_template_levels l
        where l.criterion_id = c.id
      ), '[]'::jsonb)
    ) order by c.sort_order
  ), '[]'::jsonb)
  into v_criteria
  from public.rubric_template_criteria c
  where c.template_id = p_template_id;

  return jsonb_build_object(
    'ok', true,
    'template', jsonb_build_object(
      'id', v_row.id,
      'owner_id', v_row.owner_id,
      'name', v_row.name,
      'description', v_row.description,
      'scoring_mode', v_row.scoring_mode,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at,
      'criteria', v_criteria
    )
  );
end;
$$;

grant execute on function public.get_rubric_template(uuid) to authenticated;

-- ── Apply template → independent frozen activity rubric snapshot ─────────────

create or replace function public.apply_rubric_template_to_activity(
  p_activity_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_max numeric;
  v_owner uuid;
  v_mode text;
  v_rubric_id uuid;
  v_existing uuid;
  v_crit record;
  v_level record;
  v_new_crit uuid;
  v_sum numeric := 0;
  v_crit_max numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max
  from public.activities a where a.id = p_activity_id;
  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;
  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select owner_id, scoring_mode into v_owner, v_mode
  from public.rubric_templates where id = p_template_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;
  if v_owner <> v_uid and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select r.id into v_existing
  from public.activity_rubrics r where r.activity_id = p_activity_id;
  if v_existing is not null and public.activity_rubric_has_evaluations(v_existing) then
    return jsonb_build_object('ok', false, 'error', 'rubric_has_evaluations');
  end if;

  if v_mode = 'points' then
    select coalesce(sum(mx), 0) into v_sum
    from (
      select max(l.points) as mx
      from public.rubric_template_criteria c
      join public.rubric_template_levels l on l.criterion_id = c.id
      where c.template_id = p_template_id
      group by c.id
    ) q;
    if v_max is null then
      return jsonb_build_object('ok', false, 'error', 'max_points_required');
    end if;
    if abs(v_sum - v_max) > 0.0001 then
      return jsonb_build_object(
        'ok', false,
        'error', 'rubric_max_mismatch',
        'rubric_sum', v_sum,
        'max_points', v_max
      );
    end if;
  end if;

  delete from public.activity_rubrics where activity_id = p_activity_id;

  insert into public.activity_rubrics (
    activity_id, scoring_mode, source_template_id, schema_generation, frozen_at, updated_at
  ) values (
    p_activity_id, v_mode, p_template_id, 2, now(), now()
  ) returning id into v_rubric_id;

  for v_crit in
    select * from public.rubric_template_criteria
    where template_id = p_template_id
    order by sort_order
  loop
    v_crit_max := null;
    if v_mode = 'points' then
      select max(l.points) into v_crit_max
      from public.rubric_template_levels l
      where l.criterion_id = v_crit.id;
    end if;
    insert into public.activity_rubric_criteria (
      rubric_id, name, description, max_points, sort_order
    ) values (
      v_rubric_id, v_crit.name, v_crit.description, v_crit_max, v_crit.sort_order
    ) returning id into v_new_crit;

    for v_level in
      select * from public.rubric_template_levels
      where criterion_id = v_crit.id
      order by sort_order
    loop
      insert into public.activity_rubric_levels (
        criterion_id, name, descriptor, sort_order, points
      ) values (
        v_new_crit,
        v_level.name,
        v_level.descriptor,
        v_level.sort_order,
        case when v_mode = 'points' then v_level.points else null end
      );
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'rubric_id', v_rubric_id, 'scoring_mode', v_mode);
end;
$$;

grant execute on function public.apply_rubric_template_to_activity(uuid, uuid) to authenticated;

-- ── Upsert activity rubric (direct authoring / freeze boundary) ──────────────

drop function if exists public.upsert_activity_rubric(uuid, jsonb);

create or replace function public.upsert_activity_rubric(
  p_activity_id uuid,
  p_criteria jsonb,
  p_scoring_mode text default 'points'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_max numeric;
  v_sum numeric := 0;
  v_rubric_id uuid;
  v_existing uuid;
  v_elem jsonb;
  v_level jsonb;
  v_idx int := 0;
  v_lidx int;
  v_name text;
  v_desc text;
  v_pts numeric;
  v_mode text;
  v_crit_id uuid;
  v_level_name text;
  v_descriptor text;
  v_level_points numeric;
  v_has_levels boolean;
  v_crit_max numeric;
  v_schema int := 2;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max
  from public.activities a where a.id = p_activity_id;
  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;
  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_mode := lower(trim(coalesce(p_scoring_mode, 'points')));
  if v_mode not in ('qualitative', 'points') then
    return jsonb_build_object('ok', false, 'error', 'scoring_mode_required');
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) < 1 then
    return jsonb_build_object('ok', false, 'error', 'criteria_required');
  end if;

  select r.id into v_existing
  from public.activity_rubrics r where r.activity_id = p_activity_id;
  if v_existing is not null and public.activity_rubric_has_evaluations(v_existing) then
    return jsonb_build_object('ok', false, 'error', 'rubric_has_evaluations');
  end if;

  -- Detect legacy payload (criteria with max_points, no levels) for gen-1 path.
  v_has_levels := false;
  for v_elem in select * from jsonb_array_elements(p_criteria)
  loop
    if v_elem->'levels' is not null and jsonb_typeof(v_elem->'levels') = 'array'
       and jsonb_array_length(v_elem->'levels') > 0 then
      v_has_levels := true;
      exit;
    end if;
  end loop;

  if not v_has_levels then
    v_schema := 1;
    v_mode := 'points';
    if v_max is null then
      return jsonb_build_object('ok', false, 'error', 'max_points_required');
    end if;
    for v_elem in select * from jsonb_array_elements(p_criteria)
    loop
      begin
        v_pts := (v_elem->>'max_points')::numeric;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_criterion_max');
      end;
      if v_pts is null or v_pts <= 0 then
        return jsonb_build_object('ok', false, 'error', 'invalid_criterion_max');
      end if;
      v_sum := v_sum + v_pts;
    end loop;
    if abs(v_sum - v_max) > 0.0001 then
      return jsonb_build_object(
        'ok', false, 'error', 'rubric_max_mismatch',
        'rubric_sum', v_sum, 'max_points', v_max
      );
    end if;
  else
    if v_mode = 'points' then
      if v_max is null then
        return jsonb_build_object('ok', false, 'error', 'max_points_required');
      end if;
      for v_elem in select * from jsonb_array_elements(p_criteria)
      loop
        v_crit_max := null;
        for v_level in select * from jsonb_array_elements(v_elem->'levels')
        loop
          begin
            v_level_points := (v_level->>'points')::numeric;
          exception when others then
            return jsonb_build_object('ok', false, 'error', 'invalid_level_points');
          end;
          if v_level_points is null or v_level_points < 0 then
            return jsonb_build_object('ok', false, 'error', 'level_points_required');
          end if;
          if v_crit_max is null or v_level_points > v_crit_max then
            v_crit_max := v_level_points;
          end if;
        end loop;
        if v_crit_max is null then
          return jsonb_build_object('ok', false, 'error', 'levels_required');
        end if;
        v_sum := v_sum + v_crit_max;
      end loop;
      if abs(v_sum - v_max) > 0.0001 then
        return jsonb_build_object(
          'ok', false, 'error', 'rubric_max_mismatch',
          'rubric_sum', v_sum, 'max_points', v_max
        );
      end if;
    end if;
  end if;

  insert into public.activity_rubrics (
    activity_id, scoring_mode, schema_generation, frozen_at, updated_at, source_template_id
  ) values (
    p_activity_id, v_mode, v_schema, now(), now(), null
  )
  on conflict (activity_id) do update set
    scoring_mode = excluded.scoring_mode,
    schema_generation = excluded.schema_generation,
    frozen_at = now(),
    updated_at = now(),
    source_template_id = null
  returning id into v_rubric_id;

  delete from public.activity_rubric_criteria where rubric_id = v_rubric_id;

  for v_elem in select * from jsonb_array_elements(p_criteria)
  loop
    v_name := nullif(trim(coalesce(v_elem->>'name', '')), '');
    v_desc := nullif(trim(coalesce(v_elem->>'description', '')), '');
    if v_name is null then
      return jsonb_build_object('ok', false, 'error', 'criterion_name_required');
    end if;

    if v_schema = 1 then
      v_pts := (v_elem->>'max_points')::numeric;
      insert into public.activity_rubric_criteria (
        rubric_id, name, description, max_points, sort_order
      ) values (
        v_rubric_id, v_name, v_desc, v_pts, v_idx
      );
    else
      v_crit_max := null;
      if v_mode = 'points' then
        select max((l->>'points')::numeric) into v_crit_max
        from jsonb_array_elements(v_elem->'levels') l;
      end if;
      insert into public.activity_rubric_criteria (
        rubric_id, name, description, max_points, sort_order
      ) values (
        v_rubric_id, v_name, v_desc, v_crit_max, v_idx
      ) returning id into v_crit_id;

      v_lidx := 0;
      for v_level in select * from jsonb_array_elements(v_elem->'levels')
      loop
        v_level_name := nullif(trim(coalesce(v_level->>'name', '')), '');
        v_descriptor := nullif(trim(coalesce(v_level->>'descriptor', coalesce(v_level->>'description', ''))), '');
        if v_level_name is null then
          return jsonb_build_object('ok', false, 'error', 'level_name_required');
        end if;
        v_level_points := null;
        if v_mode = 'points' then
          v_level_points := (v_level->>'points')::numeric;
        end if;
        insert into public.activity_rubric_levels (
          criterion_id, name, descriptor, sort_order, points
        ) values (
          v_crit_id, v_level_name, v_descriptor, v_lidx, v_level_points
        );
        v_lidx := v_lidx + 1;
      end loop;
    end if;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'rubric_id', v_rubric_id,
    'scoring_mode', v_mode,
    'schema_generation', v_schema
  );
end;
$$;

grant execute on function public.upsert_activity_rubric(uuid, jsonb, text) to authenticated;

create or replace function public.clear_activity_rubric(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_rubric_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select a.course_id into v_course_id
  from public.activities a where a.id = p_activity_id;
  if v_course_id is null then
    return jsonb_build_object('ok', false, 'error', 'activity_not_found');
  end if;
  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select r.id into v_rubric_id
  from public.activity_rubrics r where r.activity_id = p_activity_id;
  if v_rubric_id is not null and public.activity_rubric_has_evaluations(v_rubric_id) then
    return jsonb_build_object('ok', false, 'error', 'rubric_has_evaluations');
  end if;

  delete from public.activity_rubrics where activity_id = p_activity_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.clear_activity_rubric(uuid) to authenticated;

-- ── Draft save / load ────────────────────────────────────────────────────────

create or replace function public.save_activity_rubric_draft(
  p_submission_id uuid,
  p_rubric_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
  v_course_id uuid;
  v_status text;
  v_elem jsonb;
  v_crit_id uuid;
  v_level_id uuid;
  v_points numeric;
  v_comment text;
  v_rubric_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id, s.status into v_activity_id, v_status
  from public.activity_submissions s where s.id = p_submission_id;
  if v_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select a.course_id into v_course_id from public.activities a where a.id = v_activity_id;
  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Draft must not change submission status / grade.
  select r.id into v_rubric_id
  from public.activity_rubrics r where r.activity_id = v_activity_id;

  delete from public.activity_submission_rubric_drafts
  where submission_id = p_submission_id;

  if p_rubric_scores is null or jsonb_typeof(p_rubric_scores) <> 'array' then
    return jsonb_build_object('ok', true, 'saved', 0, 'status', v_status);
  end if;

  for v_elem in select * from jsonb_array_elements(p_rubric_scores)
  loop
    v_crit_id := nullif(v_elem->>'criterion_id', '')::uuid;
    v_level_id := nullif(v_elem->>'level_id', '')::uuid;
    v_comment := nullif(v_elem->>'comment', '');
    v_points := null;
    if v_elem ? 'points' and nullif(v_elem->>'points', '') is not null then
      begin
        v_points := (v_elem->>'points')::numeric;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_rubric_points');
      end;
    end if;
    if v_crit_id is null then
      continue;
    end if;
    if v_rubric_id is not null and not exists (
      select 1 from public.activity_rubric_criteria c
      where c.id = v_crit_id and c.rubric_id = v_rubric_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_criterion');
    end if;
    if v_level_id is not null and not exists (
      select 1 from public.activity_rubric_levels l
      where l.id = v_level_id and l.criterion_id = v_crit_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_level');
    end if;
    insert into public.activity_submission_rubric_drafts (
      submission_id, criterion_id, level_id, points, comment, updated_at
    ) values (
      p_submission_id, v_crit_id, v_level_id, v_points, v_comment, now()
    );
  end loop;

  return jsonb_build_object('ok', true, 'status', v_status, 'graded', false);
end;
$$;

grant execute on function public.save_activity_rubric_draft(uuid, jsonb) to authenticated;

-- ── grade_activity_submission: P9 qualitative / points / legacy ──────────────

drop function if exists public.grade_activity_submission(uuid, numeric, text, jsonb);

create or replace function public.grade_activity_submission(
  p_submission_id uuid,
  p_grade numeric,
  p_feedback text,
  p_rubric_scores jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
  v_course_id uuid;
  v_status text;
  v_max numeric;
  v_rubric_id uuid;
  v_mode text;
  v_schema int;
  v_sum_max numeric;
  v_total numeric := 0;
  v_elem jsonb;
  v_crit_id uuid;
  v_level_id uuid;
  v_points numeric;
  v_comment text;
  v_crit_max numeric;
  v_level_name text;
  v_level_descriptor text;
  v_level_points numeric;
  v_row public.activity_submissions%rowtype;
  v_final_grade numeric;
  v_crit_count int;
  v_scored_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  select s.activity_id, s.status into v_activity_id, v_status
  from public.activity_submissions s where s.id = p_submission_id;
  if v_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select a.course_id, a.max_points into v_course_id, v_max
  from public.activities a where a.id = v_activity_id;

  if not public.is_course_teacher(v_course_id)
     and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_status not in ('submitted', 'returned', 'graded') then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  select r.id, r.scoring_mode, r.schema_generation
    into v_rubric_id, v_mode, v_schema
  from public.activity_rubrics r
  where r.activity_id = v_activity_id
  limit 1;

  if v_rubric_id is not null then
    if p_rubric_scores is null or jsonb_typeof(p_rubric_scores) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'rubric_scores_required');
    end if;

    select count(*) into v_crit_count
    from public.activity_rubric_criteria c where c.rubric_id = v_rubric_id;

    if coalesce(v_schema, 1) = 1 or not exists (
      select 1
      from public.activity_rubric_criteria c
      join public.activity_rubric_levels l on l.criterion_id = c.id
      where c.rubric_id = v_rubric_id
    ) then
      -- Legacy gen-1: criteria + arbitrary numeric points (no level semantics).
      select coalesce(sum(c.max_points), 0) into v_sum_max
      from public.activity_rubric_criteria c where c.rubric_id = v_rubric_id;
      if v_max is not null and abs(v_sum_max - v_max) > 0.0001 then
        return jsonb_build_object(
          'ok', false, 'error', 'rubric_max_mismatch',
          'rubric_sum', v_sum_max, 'max_points', v_max
        );
      end if;

      delete from public.activity_submission_rubric_scores where submission_id = p_submission_id;

      for v_elem in select * from jsonb_array_elements(p_rubric_scores)
      loop
        v_crit_id := nullif(v_elem->>'criterion_id', '')::uuid;
        begin
          v_points := (v_elem->>'points')::numeric;
        exception when others then
          return jsonb_build_object('ok', false, 'error', 'invalid_rubric_points');
        end;
        v_comment := nullif(v_elem->>'comment', '');
        if v_crit_id is null then
          return jsonb_build_object('ok', false, 'error', 'missing_criterion_id');
        end if;
        select c.max_points into v_crit_max
        from public.activity_rubric_criteria c
        where c.id = v_crit_id and c.rubric_id = v_rubric_id;
        if v_crit_max is null then
          return jsonb_build_object('ok', false, 'error', 'invalid_criterion');
        end if;
        if v_points is null or v_points < 0 or v_points > v_crit_max then
          return jsonb_build_object('ok', false, 'error', 'criterion_points_out_of_range');
        end if;
        insert into public.activity_submission_rubric_scores (
          submission_id, criterion_id, points, comment, level_id, level_name, level_descriptor, updated_at
        ) values (
          p_submission_id, v_crit_id, v_points, v_comment, null, null, null, now()
        );
        v_total := v_total + v_points;
        v_scored_count := v_scored_count + 1;
      end loop;
      if v_scored_count <> v_crit_count then
        return jsonb_build_object('ok', false, 'error', 'incomplete_rubric');
      end if;
      v_final_grade := v_total;
    else
      -- P9 levels path
      if v_mode = 'points' then
        select coalesce(sum(public.rubric_criterion_points_ceiling(c.id)), 0) into v_sum_max
        from public.activity_rubric_criteria c where c.rubric_id = v_rubric_id;
        if v_max is not null and abs(v_sum_max - v_max) > 0.0001 then
          return jsonb_build_object(
            'ok', false, 'error', 'rubric_max_mismatch',
            'rubric_sum', v_sum_max, 'max_points', v_max
          );
        end if;
      end if;

      delete from public.activity_submission_rubric_scores where submission_id = p_submission_id;

      for v_elem in select * from jsonb_array_elements(p_rubric_scores)
      loop
        v_crit_id := nullif(v_elem->>'criterion_id', '')::uuid;
        v_level_id := nullif(v_elem->>'level_id', '')::uuid;
        v_comment := nullif(v_elem->>'comment', '');
        if v_crit_id is null then
          return jsonb_build_object('ok', false, 'error', 'missing_criterion_id');
        end if;
        if v_level_id is null then
          return jsonb_build_object('ok', false, 'error', 'level_required');
        end if;
        if not exists (
          select 1 from public.activity_rubric_criteria c
          where c.id = v_crit_id and c.rubric_id = v_rubric_id
        ) then
          return jsonb_build_object('ok', false, 'error', 'invalid_criterion');
        end if;

        select l.name, l.descriptor, l.points
          into v_level_name, v_level_descriptor, v_level_points
        from public.activity_rubric_levels l
        where l.id = v_level_id and l.criterion_id = v_crit_id;
        if v_level_name is null then
          return jsonb_build_object('ok', false, 'error', 'invalid_level');
        end if;

        -- Server-authoritative points from frozen level; ignore client points.
        if v_mode = 'qualitative' then
          v_points := null;
        else
          if v_level_points is null then
            return jsonb_build_object('ok', false, 'error', 'level_points_required');
          end if;
          v_points := v_level_points;
          v_total := v_total + v_points;
        end if;

        insert into public.activity_submission_rubric_scores (
          submission_id, criterion_id, points, comment,
          level_id, level_name, level_descriptor, updated_at
        ) values (
          p_submission_id, v_crit_id, v_points, v_comment,
          v_level_id, v_level_name, v_level_descriptor, now()
        );
        v_scored_count := v_scored_count + 1;
      end loop;

      if v_scored_count <> v_crit_count then
        return jsonb_build_object('ok', false, 'error', 'incomplete_rubric');
      end if;

      if v_mode = 'qualitative' then
        v_final_grade := null;
      else
        v_final_grade := v_total;
      end if;
    end if;

    -- Clear drafts on publish.
    delete from public.activity_submission_rubric_drafts where submission_id = p_submission_id;
  else
    v_final_grade := p_grade;
  end if;

  if v_rubric_id is not null and v_mode = 'qualitative' then
    -- Qualitative: activity_submissions.grade may be null; never invent grade=0.
    null;
  elsif v_final_grade is null then
    return jsonb_build_object('ok', false, 'error', 'grade_required');
  end if;

  if v_final_grade is not null then
    if v_max is not null and v_final_grade > v_max then
      return jsonb_build_object('ok', false, 'error', 'grade_exceeds_max');
    end if;
    if v_final_grade < 0 then
      return jsonb_build_object('ok', false, 'error', 'grade_negative');
    end if;
  end if;

  update public.activity_submissions
  set
    grade = v_final_grade, -- official activity_submissions.grade
    feedback = p_feedback,
    graded_by = v_uid,
    graded_at = now(),
    status = 'graded',
    updated_at = now()
  where id = p_submission_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'grade', v_row.grade,
    'feedback', v_row.feedback,
    'scoring_mode', v_mode
  );
end;
$$;

grant execute on function public.grade_activity_submission(uuid, numeric, text, jsonb) to authenticated;
