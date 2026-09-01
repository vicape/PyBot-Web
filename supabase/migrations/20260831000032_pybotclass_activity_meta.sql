-- Migración 032 — PyBotClass: metadatos de actividades
-- IDEMPOTENTE

alter table public.activities
  add column if not exists origin text not null default 'pybot';

alter table public.activities
  drop constraint if exists activities_origin_check;

alter table public.activities
  add constraint activities_origin_check
  check (origin in ('pybot', 'classroom'));

alter table public.activities
  add column if not exists due_at timestamptz null;

alter table public.activities
  add column if not exists max_points numeric null;

alter table public.activities
  add column if not exists classroom_last_synced_at timestamptz null;

create unique index if not exists activities_course_classroom_coursework_uidx
  on public.activities (course_id, classroom_coursework_id)
  where classroom_coursework_id is not null;
