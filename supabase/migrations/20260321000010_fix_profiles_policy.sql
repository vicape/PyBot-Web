-- La política profiles_see_org_members tiene un JOIN costoso que cuelga consultas simples.
-- Se reemplaza por una versión más eficiente usando una función security definer.

drop policy if exists profiles_see_org_members on public.profiles;

-- Política liviana: ver perfil propio (la original ya existe como profiles_select_own,
-- pero la redefinimos por si fue dropeada)
create policy if not exists profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- Para que docentes puedan ver perfiles de sus alumnos, usar la función find_profile_by_email
-- (ya definida en migración 008) en lugar de una política con JOIN.
