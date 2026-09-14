-- READY FOR MIGRATION REVIEW — P16 server-only Classroom refresh tokens
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Goal: stop reading google_refresh_token from the browser under RLS.
-- Keep profiles columns during transition; dual-read then cut over.
--
-- Proposed phases:
-- 1) Create private schema/table or vault for refresh tokens (service role only).
-- 2) Dual-write from confirmClassroomPersistence + exchange endpoint.
-- 3) Change getValidClassroomToken path to call server with Bearer Supabase only
--    (already refreshes via /api/refresh-classroom-token).
-- 4) Stop selecting google_refresh_token in profileApi frontend selects.
-- 5) Eventually NULL browser-readable columns after backfill verified.
--
-- Rollback: keep profiles.google_* populated; frontend falls back to current P1 path.
--
-- This file is a marker + checklist. Full cutover requires Vercel/Supabase review.

do $$
begin
  raise notice 'P16 READY FOR MIGRATION REVIEW: server-only Classroom refresh tokens';
end $$;
