-- READY FOR MIGRATION REVIEW — P7 conservative roster (no auto-delete students)
-- DO NOT APPLY TO PRODUCTION without human review.
--
-- Until applied, the app already unions existing course_members.classroom_user_id
-- into p_active_classroom_user_ids so the current RPC cannot prune retained students.
--
-- This migration should rewrite sync_classroom_course_roster (and related pending prune)
-- to stop DELETE of course_members students on sync. Prefer soft-flag / manual unlink later.
--
-- Rollback conceptual: restore previous function body from 20260830000026 / 20260831000031.
--
-- Placeholder marker (no-op) so the file is reviewable without changing behavior if applied early:

do $$
begin
  raise notice 'P7 migration review: remove auto-delete from sync_classroom_course_roster before cutover';
end $$;
