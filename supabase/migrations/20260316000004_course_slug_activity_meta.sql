-- Columnas opcionales para plataforma (ejecutar si creaste tablas sin estos campos).

alter table public.courses add column if not exists slug text;

alter table public.activities add column if not exists description text default '';

alter table public.activities add column if not exists pybot_lesson_id text;

create index if not exists courses_org_slug_idx on public.courses (org_id, slug);
