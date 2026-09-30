/**
 * Mutación acotada del rol pedagógico en un curso (course_members.role).
 * No toca organization_members ni preferred_role.
 */
import { normalizeCourseRole } from "./courseRole.js";

const COURSE_ROLES = new Set(["teacher", "student"]);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   courseId: string,
 *   userId: string,
 *   role: "teacher"|"student"|string,
 *   actorUserId?: string | null,
 * }} params
 * @returns {Promise<{
 *   ok: boolean,
 *   error: string | null,
 *   row: {
 *     course_id: string,
 *     user_id: string,
 *     role: string,
 *     source: string,
 *     classroom_user_id: string | null,
 *     classroom_email: string | null,
 *     created_at: string,
 *     synced_at: string | null,
 *   } | null,
 * }>}
 */
export async function updateCourseMemberRole(
  supabase,
  { courseId, userId, role, actorUserId = null },
) {
  if (!supabase || !courseId || !userId) {
    return { ok: false, error: "missing_args", row: null };
  }

  const nextRole = normalizeCourseRole(role);
  if (!COURSE_ROLES.has(nextRole)) {
    return { ok: false, error: "invalid_role", row: null };
  }

  if (actorUserId && actorUserId === userId) {
    return { ok: false, error: "cannot_change_own_role", row: null };
  }

  const { data, error } = await supabase
    .from("course_members")
    .update({ role: nextRole })
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .select(
      "course_id, user_id, role, source, classroom_user_id, classroom_email, created_at, synced_at",
    )
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message || "update_failed", row: null };
  }
  if (!data) {
    return { ok: false, error: "not_found_or_forbidden", row: null };
  }
  if (data.role !== nextRole) {
    return { ok: false, error: "role_unchanged", row: data };
  }

  return { ok: true, error: null, row: data };
}

/**
 * ¿Se puede mostrar el control de cambio de rol en una fila del roster?
 * UI gate only — RLS sigue siendo autoritativo.
 *
 * @param {{
 *   memberUserId?: string | null,
 *   actorUserId?: string | null,
 *   canManageRoster?: boolean,
 *   isPending?: boolean,
 * }} opts
 */
export function canShowCourseRoleChangeAction({
  memberUserId = null,
  actorUserId = null,
  canManageRoster = false,
  isPending = false,
} = {}) {
  if (!canManageRoster) return false;
  if (isPending) return false;
  if (!memberUserId) return false;
  if (actorUserId && memberUserId === actorUserId) return false;
  return true;
}
