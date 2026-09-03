-- Fix: infinite recursion en policies de content_units / learning_contents.
-- Las policies "assigned" no deben hacer EXISTS sobre tablas hermanas con RLS;
-- usan helpers SECURITY DEFINER.

create or replace function public.can_access_assigned_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_lessons l
    join public.activities a on a.content_lesson_id = l.id
    where l.unit_id = p_unit_id
      and public.activity_visible_to_me(a.id)
  );
$$;

create or replace function public.can_access_assigned_content(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_units u
    join public.content_lessons l on l.unit_id = u.id
    join public.activities a on a.content_lesson_id = l.id
    where u.content_id = p_content_id
      and public.activity_visible_to_me(a.id)
  );
$$;

grant execute on function public.can_access_assigned_unit(uuid) to authenticated;
grant execute on function public.can_access_assigned_content(uuid) to authenticated;

drop policy if exists content_units_select_assigned on public.content_units;
create policy content_units_select_assigned on public.content_units
  for select using (public.can_access_assigned_unit(id));

drop policy if exists learning_contents_select_assigned on public.learning_contents;
create policy learning_contents_select_assigned on public.learning_contents
  for select using (public.can_access_assigned_content(id));
