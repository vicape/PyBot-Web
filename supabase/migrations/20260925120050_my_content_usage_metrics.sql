-- Additive: secure aggregate usage metrics for the caller's owned learning_contents.
-- Counts only (no identities). Does not weaken learning_contents / activities RLS.
-- Derives current usage from existing copy + direct assignment rows (no denormalized counters).
--
-- CURRENT USE semantics (exact):
--   Copy: distinct external learning_contents.owner_id where copied_from_content_id = content.id
--   Assignment: distinct activities.created_by where content_source_type='content'
--               AND content_source_id = content.id
--   Overall: distinct-user UNION (must never equal copy_count + assignment_count when same user in both)
--   Owner (auth.uid()) excluded from every metric; deleted rows do not count.
-- visibility = community | visibility = courses | visibility = private are owner sharing states (UI).

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

  return query
  with owned as (
    select lc.id
    from public.learning_contents lc
    where lc.owner_id = v_uid
  ),
  copy_users as (
    select
      c.copied_from_content_id as content_id,
      c.owner_id as user_id
    from public.learning_contents c
    inner join owned o on o.id = c.copied_from_content_id
    where c.owner_id is not null
      and c.owner_id is distinct from v_uid
  ),
  assign_users as (
    select
      a.content_source_id as content_id,
      a.created_by as user_id
    from public.activities a
    inner join owned o on o.id = a.content_source_id
    where a.content_source_type = 'content'
      and a.content_source_id is not null
      and a.created_by is not null
      and a.created_by is distinct from v_uid
  ),
  copy_counts as (
    select cu.content_id, count(distinct cu.user_id)::bigint as n
    from copy_users cu
    group by cu.content_id
  ),
  assign_counts as (
    select au.content_id, count(distinct au.user_id)::bigint as n
    from assign_users au
    group by au.content_id
  ),
  total_counts as (
    select u.content_id, count(distinct u.user_id)::bigint as n
    from (
      select content_id, user_id from copy_users
      union
      select content_id, user_id from assign_users
    ) u
    group by u.content_id
  )
  select
    o.id as content_id,
    coalesce(cc.n, 0)::bigint as distinct_copy_user_count,
    coalesce(ac.n, 0)::bigint as distinct_assignment_user_count,
    coalesce(tc.n, 0)::bigint as distinct_total_user_count
  from owned o
  left join copy_counts cc on cc.content_id = o.id
  left join assign_counts ac on ac.content_id = o.id
  left join total_counts tc on tc.content_id = o.id;
end;
$$;

revoke all on function public.get_my_content_usage_metrics() from public;
grant execute on function public.get_my_content_usage_metrics() to authenticated;

comment on function public.get_my_content_usage_metrics() is
  'Returns distinct external copy/assignment usage counts for learning_contents owned by auth.uid(). Counts only; excludes owner; no identity exposure.';
