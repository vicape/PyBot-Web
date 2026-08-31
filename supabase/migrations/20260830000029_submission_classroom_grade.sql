-- Migración 029 — Sync de nota PyBot → Classroom en activity_submissions
-- IDEMPOTENTE.

alter table public.activity_submissions
  add column if not exists classroom_grade_synced_at timestamptz;

alter table public.activity_submissions
  add column if not exists classroom_grade_sync_error text;

alter table public.activity_submissions
  add column if not exists classroom_submission_id text;
