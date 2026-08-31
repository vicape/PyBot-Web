-- Migración 021 — IP completa en usage_sessions (solo backend / service_role).
-- IDEMPOTENTE.

alter table public.usage_sessions
  add column if not exists ip text;

create index if not exists usage_sessions_ip_idx
  on public.usage_sessions (ip);
