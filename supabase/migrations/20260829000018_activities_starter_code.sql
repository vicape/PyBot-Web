-- ──────────────────────────────────────────────────────────────────────────
-- Migración 018 — Columna starter_code en activities (si faltaba).
-- IDEMPOTENTE. Algunas bases tienen activities sin esta columna del esquema base.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.activities add column if not exists starter_code text not null default '';

-- Asegurar columnas opcionales usadas por el IDE web
alter table public.activities add column if not exists description text default '';
alter table public.activities add column if not exists pybot_lesson_id text;

-- Política INSERT para staff (por si no existía)
drop policy if exists activities_insert_staff on public.activities;
create policy activities_insert_staff on public.activities
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.courses c
      where c.id = activities.course_id
        and public.is_org_staff(c.org_id)
    )
  );
