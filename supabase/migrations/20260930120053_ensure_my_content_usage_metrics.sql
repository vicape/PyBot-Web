-- Additive ensure: reconcile deployed get_my_content_usage_metrics with canonical
-- supabase/migrations/20260925120050_my_content_usage_metrics.sql (do not rewrite that file).
-- Idempotent. Preserves CURRENT USE semantics (distinct external copy/assignment; UNION total; owner excluded).
--
-- Observed production: POST /rest/v1/rpc/get_my_content_usage_metrics → HTTP 400 for authenticated teachers.
-- Likely causes this ensure addresses:
--   1) Function missing / stale PostgREST schema cache after 050
--   2) Broken overload / prior signature mismatch
--   3) plpgsql RETURNS TABLE OUT-param name shadowing on content_id (runtime 400)
-- Prerequisite columns are ensured IF NOT EXISTS (same pattern as 047).

alter table public.learning_contents
  add column if not exists copied_from_content_id uuid;

alter table public.activities
  add column if not exists content_source_type text;

alter table public.activities
  add column if not exists content_source_id uuid;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_my_content_usage_metrics'
  loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

create or replace function public.get_my_content_usage_metrics()
returns table (
  content_id uuid,
  distinct_copy_user_count bigint,
  distinct_assignment_user_count bigint,
  distinct_total_user_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Internal CTE column names intentionally avoid OUT-param names (content_id, …)
  -- to prevent plpgsql variable shadowing that can yield runtime errors / bad plans.
  return query
  with owned as (
    select lc.id as owned_id
    from public.learning_contents lc
    where lc.owner_id = v_uid
  ),
  copy_users as (
    select
      c.copied_from_content_id as src_id,
      c.owner_id as actor_id
    from public.learning_contents c
    inner join owned o on o.owned_id = c.copied_from_content_id
    where c.owner_id is not null
      and c.owner_id is distinct from v_uid
  ),
  assign_users as (
    select
      a.content_source_id as src_id,
      a.created_by as actor_id
    from public.activities a
    inner join owned o on o.owned_id = a.content_source_id
    where a.content_source_type = 'content'
      and a.content_source_id is not null
      and a.created_by is not null
      and a.created_by is distinct from v_uid
  ),
  copy_counts as (
    select cu.src_id, count(distinct cu.actor_id)::bigint as n
    from copy_users cu
    group by cu.src_id
  ),
  assign_counts as (
    select au.src_id, count(distinct au.actor_id)::bigint as n
    from assign_users au
    group by au.src_id
  ),
  total_counts as (
    select u.src_id, count(distinct u.actor_id)::bigint as n
    from (
      select src_id, actor_id from copy_users
      union
      select src_id, actor_id from assign_users
    ) u
    group by u.src_id
  )
  select
    o.owned_id,
    coalesce(cc.n, 0)::bigint,
    coalesce(ac.n, 0)::bigint,
    coalesce(tc.n, 0)::bigint
  from owned o
  left join copy_counts cc on cc.src_id = o.owned_id
  left join assign_counts ac on ac.src_id = o.owned_id
  left join total_counts tc on tc.src_id = o.owned_id;
end;
$$;

revoke all on function public.get_my_content_usage_metrics() from public;
grant execute on function public.get_my_content_usage_metrics() to authenticated;

comment on function public.get_my_content_usage_metrics() is
  'Returns distinct external copy/assignment usage counts for learning_contents owned by auth.uid(). Counts only; excludes owner; no identity exposure.';

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
