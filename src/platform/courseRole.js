import { isStaffRole } from "../orgRole.js";

/**
 * Rol efectivo en un curso (no rol institucional).
 * owner (acceso staff vía org) → teacher; desconocido → null (nunca student).
 * @param {unknown} role
 * @returns {"teacher"|"student"|null}
 */
export function normalizeCourseRole(role) {
  if (role === "owner" || role === "teacher") return "teacher";
  if (role === "student") return "student";
  return null;
}

/**
 * Capacidades docentes sobre un curso concreto.
 * @param {{ orgRole?: string | null, courseRole?: string | null }} opts
 */
export function canTeachCourse({ orgRole = null, courseRole = null } = {}) {
  return isStaffRole(orgRole) || normalizeCourseRole(courseRole) === "teacher";
}

/**
 * ¿Es alumno inscrito en el curso? (no co-docente)
 * @param {{ courseRole?: string | null }} opts
 */
export function isCourseStudent({ courseRole = null } = {}) {
  return normalizeCourseRole(courseRole) === "student";
}

/**
 * Lee el rol del usuario en course_members.
 * @returns {Promise<string | null>}
 */
export async function fetchMyCourseRole(supabase, courseId, userId) {
  if (!supabase || !courseId || !userId) return null;

  const { data, error } = await supabase
    .from("course_members")
    .select("role")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("fetchMyCourseRole:", error);
    return null;
  }
  return data?.role ?? null;
}
