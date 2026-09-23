-- Migración 047 — Asegurar contrato del listado de activities + RPC my_role_in_org
-- IDEMPOTENTE / aditiva / no destructiva.
--
-- Cierra el desfase observado en producción:
--   1) GET /rest/v1/activities?select=...submission_close_at... → HTTP 400
--      (columna ausente del schema cache si 046 no se aplicó)
--   2) POST /rest/v1/rpc/my_role_in_org → HTTP 404
--      (función de migración 012 no publicada en PostgREST)
--
-- El frontend también omite submission_close_at en el select primario del listado
-- y resuelve el rol vía organization_members (equivalente fail-closed).

-- ── Columna que provoca el 400 del select evidenciado ────────────────────────

alter table public.activities
  add column if not exists submission_close_at timestamptz;

comment on column public.activities.submission_close_at is
  'Cierre efectivo de recepción. Null = sin cierre (se permite entrega tras due_at como tarde).';

-- ── Columnas del resto del contrato de listado (no-op si ya existen) ─────────

alter table public.activities
  add column if not exists classroom_coursework_id text;

alter table public.activities
  add column if not exists classroom_coursework_url text;

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

alter table public.activities
  add column if not exists content_snapshot jsonb;

alter table public.activities
  add column if not exists content_source_type text;

alter table public.activities
  add column if not exists content_source_id uuid;

alter table public.activities
  add column if not exists activity_kind text;

-- content_lesson_id: con FK solo si existe content_lessons
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activities'
      and column_name = 'content_lesson_id'
  ) then
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'content_lessons'
    ) then
      alter table public.activities
        add column content_lesson_id uuid
          references public.content_lessons (id) on delete set null;
    else
      alter table public.activities
        add column content_lesson_id uuid;
    end if;
  end if;
end $$;

alter table public.activities
  drop constraint if exists activities_content_source_type_check;
alter table public.activities
  add constraint activities_content_source_type_check
  check (
    content_source_type is null
    or content_source_type in ('content', 'unit', 'lesson', 'exercise', 'task')
  );

alter table public.activities
  drop constraint if exists activities_activity_kind_check;
alter table public.activities
  add constraint activities_activity_kind_check
  check (
    activity_kind is null
    or activity_kind in ('material', 'exercise', 'task')
  );

-- ── RPC my_role_in_org (misma semántica que migración 012) ───────────────────

create or replace function public.my_role_in_org(p_org_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.organization_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.my_role_in_org(uuid) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
