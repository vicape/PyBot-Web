-- Soporte para importar alumnos desde Google Classroom.

-- Función: buscar perfil por email (security definer para saltear RLS de profiles)
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $$
  select id, display_name, avatar_url
  from public.profiles
  where lower(trim(email)) = lower(trim(p_email))
  limit 1;
$$;

grant execute on function public.find_profile_by_email(text) to authenticated;

-- Política: miembros del colegio pueden ver perfiles de otros miembros del mismo colegio
drop policy if exists profiles_see_org_members on public.profiles;
create policy profiles_see_org_members on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members om1
      join public.organization_members om2 on om1.org_id = om2.org_id
      where om1.user_id = auth.uid()
        and om2.user_id = profiles.id
    )
  );

-- Política: docentes/owners pueden ver progress de alumnos de sus cursos
drop policy if exists ap_staff_view on public.activity_progress;
create policy ap_staff_view on public.activity_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.activities a
      join public.courses c on c.id = a.course_id
      join public.organization_members m on m.org_id = c.org_id
      where a.id = activity_progress.activity_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'teacher')
    )
  );
