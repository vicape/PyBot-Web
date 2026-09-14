/**
 * Desconectar integración Classroom (P15).
 * No cierra sesión PyBot, no borra cursos/actividades/submissions.
 */

import { clearClassroomTokenCache } from "./classroomToken.js";
import { clearClassroomTokens } from "./profileApi.js";
import { clearClassroomOrgHint } from "./classroomOrgContext.js";

/**
 * @param {{ userId: string, mode?: "teacher"|"student"|"both" }} args
 */
export async function disconnectClassroomIntegration({ userId, mode = "both" } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, error: "missing_user" };

  const cleared = await clearClassroomTokens(uid, mode);
  if (!cleared.ok) return cleared;

  if (mode === "both") {
    clearClassroomTokenCache(uid);
  } else {
    clearClassroomTokenCache(uid, mode);
  }

  if (mode === "teacher" || mode === "both") {
    clearClassroomOrgHint();
  }

  return { ok: true, skipped: !!cleared.skipped };
}
