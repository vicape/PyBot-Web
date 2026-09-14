-- READY FOR MIGRATION REVIEW — P16 cutover notes (companion to 00045)
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- 00045 creates private.classroom_oauth_secrets (server-only RT) + public.organization_classroom_links.
-- This file documents cutover; it intentionally does NOT drop profiles.google_* yet
-- (dual-read fallback for refresh API until backfill verified).
--
-- App rules after 00045 applied:
--   1) exchange/refresh/disconnect APIs read/write vault with SUPABASE_SERVICE_KEY
--   2) browser never SELECTs refresh tokens
--   3) browser never writes google_*_refresh_token to profiles for new connects
--   4) getValidClassroomToken(userId, { mode, orgId }) refreshes via API with org context
--
-- Later cutover (separate migration, human-approved):
--   - stop dual-read from profiles
--   - null browser-readable refresh columns after verification
--
-- Rollback: keep profiles.google_* populated; APIs fall back when vault row missing.

do $$
begin
  raise notice 'P16 companion to 00045: vault is source of truth when present; profiles dual-read until cutover';
end $$;
