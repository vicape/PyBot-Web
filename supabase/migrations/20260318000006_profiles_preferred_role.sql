-- Rol elegido al registrarse (docente / alumno), antes de unirse a un colegio.
alter table public.profiles
  add column if not exists preferred_role text check (preferred_role in ('teacher', 'student'));
