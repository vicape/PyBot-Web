/**
 * Desconectar integración Classroom (P15).
 * Org-scoped + mode; no cierra sesión PyBot; no borra cursos/actividades.
 */

import { getSupabase } from "../supabaseClient.js";
import { clearClassroomTokenCache } from "./classroomToken.js";
import { clearClassroomTokens } from "./profileApi.js";
import { clearClassroomOrgHint } from "./classroomOrgContext.js";

const DISCONNECT_API = "/api/disconnect-classroom";

/**
 * @param {{
 *   userId: string,
 *   mode?: "teacher"|"student"|"both",
 *   orgId?: string|null,
 *   globalLegacy?: boolean,
 * }} args
 * globalLegacy: wipe perfiles legacy global solo si se pide explícitamente (nunca vía org).
 */
export async function disconnectClassroomIntegration({
  userId,
  mode = "teacher",
  orgId = null,
  globalLegacy = false,
} = {}) {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, error: "missing_user" };

  const oid = typeof orgId === "string" && orgId.trim() ? orgId.trim() : null;
  const modes =
    mode === "both" ? ["teacher", "student"] : [mode === "student" ? "student" : "teacher"];

  if (oid) {
    const sb = getSupabase();
    if (!sb) return { ok: false, error: "no_client" };
    const { data: sessionData } = await sb.auth.getSession();
    const access = sessionData?.session?.access_token;
    if (!access) return { ok: false, error: "unauthorized" };

    for (const m of modes) {
      const res = await fetch(DISCONNECT_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({
          org_id: oid,
          mode: m,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 || json.error === "org_scoped_disconnect_unavailable") {
        return { ok: false, error: "org_scoped_disconnect_unavailable", orgId: oid, mode: m };
      }
      if (!res.ok) {
        return { ok: false, error: json.error || "disconnect_failed" };
      }
      clearClassroomTokenCache(uid, m, oid);
    }
  } else if (globalLegacy) {
    for (const m of modes) {
      const cleared = await clearClassroomTokens(uid, m);
      if (!cleared.ok) return cleared;
      clearClassroomTokenCache(uid, m);
    }
  } else {
    return { ok: false, error: "missing_org" };
  }

  if (modes.includes("teacher")) {
    clearClassroomOrgHint();
  }

  return { ok: true };
}
