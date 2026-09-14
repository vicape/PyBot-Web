/**
 * Autorización server-side Classroom ↔ organización (P5/P16).
 * Un único helper para exchange / refresh / disconnect.
 * Usa service role; NO confiar en org_id del browser sin validar.
 */

import { supabaseRest } from "./_telemetryHelpers.js";
import { isUuid, normalizeClassroomMode } from "./_classroomCredentials.js";

/**
 * @param {{ userId: string, orgId: string, mode?: "teacher"|"student" }} args
 * @returns {Promise<{ ok: boolean, error?: string, role?: string|null, reason?: string }>}
 */
export async function assertClassroomOrgAccess({ userId, orgId, mode = "teacher" }) {
  const uid = String(userId || "").trim();
  const oid = String(orgId || "").trim();
  const m = normalizeClassroomMode(mode);
  if (!isUuid(uid) || !isUuid(oid)) {
    return { ok: false, error: "missing_params" };
  }

  let isSuper = false;
  try {
    const rows = await supabaseRest(`profiles?id=eq.${uid}&select=is_super_admin`, {
      method: "GET",
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    isSuper = !!row?.is_super_admin;
  } catch {
    //
  }
  if (isSuper) {
    return { ok: true, role: "super_admin", reason: "super_admin" };
  }

  let membership = null;
  try {
    const rows = await supabaseRest(
      `organization_members?user_id=eq.${uid}&org_id=eq.${oid}&select=role`,
      { method: "GET" },
    );
    membership = Array.isArray(rows) ? rows[0] : rows;
  } catch {
    return { ok: false, error: "org_lookup_failed" };
  }

  const role = membership?.role ? String(membership.role) : null;

  if (m === "teacher") {
    if (role === "owner" || role === "teacher") {
      return { ok: true, role, reason: "org_staff" };
    }
    return { ok: false, error: "forbidden_org" };
  }

  // student: org member (any role) or course_member of a course in that org
  if (role) {
    return { ok: true, role, reason: "org_member" };
  }

  try {
    const courses = await supabaseRest(`courses?org_id=eq.${oid}&select=id`, { method: "GET" });
    const ids = (Array.isArray(courses) ? courses : [])
      .map((c) => c?.id)
      .filter((id) => isUuid(id));
    if (ids.length === 0) return { ok: false, error: "forbidden_org" };

    // PostgREST: course_id=in.(...)
    const inList = ids.slice(0, 200).join(",");
    const cms = await supabaseRest(
      `course_members?user_id=eq.${uid}&course_id=in.(${inList})&select=course_id,role&limit=1`,
      { method: "GET" },
    );
    const cm = Array.isArray(cms) ? cms[0] : cms;
    if (cm?.course_id) {
      return { ok: true, role: cm.role || "student", reason: "course_member" };
    }
  } catch {
    return { ok: false, error: "org_lookup_failed" };
  }

  return { ok: false, error: "forbidden_org" };
}
