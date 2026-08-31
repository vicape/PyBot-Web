-- Migración 025 — RPC para editar actividades (staff) y cargar en el IDE
-- IDEMPOTENTE. Funciona aunque falte la política RLS de update (024).

create or replace function public.get_activity_for_ide(p_activity_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  starter_code text,
  pybot_lesson_id text,
  course_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.title, a.description, a.starter_code, a.pybot_lesson_id, a.course_id
  from public.activities a
  join public.courses c on c.id = a.course_id
  where a.id = p_activity_id
    and (
      public.is_org_staff(c.org_id)
      or coalesce(public.is_super_admin(), false)
      or exists (
        select 1
        from public.course_members cm
        where cm.course_id = c.id
          and cm.user_id = auth.uid()
      )
    );
$$;

grant execute on function public.get_activity_for_ide(uuid) to authenticated;

create or replace function public.update_activity_for_staff(
  p_activity_id uuid,
  p_title text,
  p_description text,
  p_pybot_lesson_id text,
  p_starter_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.org_id into v_org_id
  from public.activities a
  join public.courses c on c.id = a.course_id
  where a.id = p_activity_id;

  if v_org_id is null then
    raise exception 'activity_not_found';
  end if;

  if not public.is_org_staff(v_org_id) and not coalesce(public.is_super_admin(), false) then
    raise exception 'forbidden';
  end if;

  update public.activities
  set
    title = trim(p_title),
    description = coalesce(p_description, ''),
    pybot_lesson_id = nullif(trim(p_pybot_lesson_id), ''),
    starter_code = coalesce(p_starter_code, '')
  where id = p_activity_id;
end;
$$;

grant execute on function public.update_activity_for_staff(uuid, text, text, text, text) to authenticated;
