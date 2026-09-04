-- Migración 043 — Restaurar PK/unique de activity_progress + save sin ON CONFLICT frágil
-- IDEMPOTENTE.
-- Error visto: "there is no unique or exclusion constraint matching the ON CONFLICT specification"

-- 1) Deduplicar filas si hubiera duplicados (activity_id, user_id)
with ranked as (
  select
    ctid,
    row_number() over (
      partition by activity_id, user_id
      order by updated_at desc nulls last, ctid desc
    ) as rn
  from public.activity_progress
)
delete from public.activity_progress ap
using ranked r
where ap.ctid = r.ctid
  and r.rn > 1;

-- 2) Asegurar PRIMARY KEY (activity_id, user_id)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.activity_progress'::regclass
      and c.contype = 'p'
  ) then
    alter table public.activity_progress
      add constraint activity_progress_pkey primary key (activity_id, user_id);
  end if;
exception
  when others then
    -- Si ya hay unique parcial, intentar unique explícito
    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.activity_progress'::regclass
        and c.contype in ('p', 'u')
        and pg_get_constraintdef(c.oid) ilike '%activity_id%'
        and pg_get_constraintdef(c.oid) ilike '%user_id%'
    ) then
      begin
        alter table public.activity_progress
          add constraint activity_progress_activity_id_user_id_key unique (activity_id, user_id);
      exception
        when duplicate_table then null;
        when duplicate_object then null;
      end;
    end if;
end;
$$;

-- 3) RPC: update + insert (no depende de ON CONFLICT)
create or replace function public.save_activity_progress(
  p_activity_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;

  if p_activity_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_activity_id');
  end if;

  if not public.activity_visible_to_me(p_activity_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.activity_progress
  set
    code = coalesce(p_code, ''),
    updated_at = now()
  where activity_id = p_activity_id
    and user_id = v_uid;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    insert into public.activity_progress (activity_id, user_id, code, updated_at)
    values (p_activity_id, v_uid, coalesce(p_code, ''), now());
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.save_activity_progress(uuid, text) to authenticated;
