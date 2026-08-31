-- Migración 028 — Vincular activities con Google Classroom courseWork
-- IDEMPOTENTE.

alter table public.activities
  add column if not exists classroom_coursework_id text;

alter table public.activities
  add column if not exists classroom_coursework_url text;

create index if not exists activities_classroom_coursework_id_idx
  on public.activities (classroom_coursework_id)
  where classroom_coursework_id is not null;
