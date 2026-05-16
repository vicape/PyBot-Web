-- Preferencias de cuenta y vínculo Classroom (opcional).

alter table public.profiles add column if not exists classroom_linked_at timestamptz;
