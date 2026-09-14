/**
 * Confirmación de persistencia de OAuth Classroom (teacher/student).
 *
 * Paths:
 * - serverPersisted + orgId (P5/P16): verifica metadata en organization_classroom_links (sin RT).
 * - legacy refreshToken (P1/P2): save + readback + mark en profiles (solo si vault no persistió).
 */

import {
  saveGoogleTokens,
  saveStudentGoogleTokens,
  markClassroomLinked,
  markStudentClassroomLinked,
  getStoredGoogleRefreshToken,
  getStoredStudentGoogleRefreshToken,
  fetchOrganizationClassroomLink,
} from "./profileApi.js";

/**
 * @param {{
 *   userId: string,
 *   mode: "teacher"|"student",
 *   refreshToken?: string,
 *   expiresIn?: number,
 *   orgId?: string|null,
 *   serverPersisted?: boolean,
 * }} args
 * @param {object} [api] inyección opcional para tests
 */
export async function confirmClassroomPersistence(
  { userId, mode, refreshToken, expiresIn, orgId, serverPersisted },
  api = {
    saveGoogleTokens,
    saveStudentGoogleTokens,
    markClassroomLinked,
    markStudentClassroomLinked,
    getStoredGoogleRefreshToken,
    getStoredStudentGoogleRefreshToken,
    fetchOrganizationClassroomLink,
  },
) {
  const uid = String(userId || "").trim();
  if (!uid) {
    return {
      ok: false,
      code: "missing_user",
      message: "No se pudo confirmar la conexión permanente con Google Classroom.",
    };
  }

  const isStudent = mode === "student";
  const oid = typeof orgId === "string" ? orgId.trim() : "";

  // P5/P16: exchange ya persistió en vault — confirmar solo metadata (nunca RT).
  if (serverPersisted) {
    if (!oid) {
      return {
        ok: false,
        code: "missing_org",
        message: "Falta el colegio para confirmar la conexión de Classroom.",
      };
    }
    const link = await api.fetchOrganizationClassroomLink(uid, oid, mode);
    if (!link?.ok) {
      return {
        ok: false,
        code: "persist_unconfirmed",
        message: "No se pudo confirmar la conexión permanente con Google Classroom.",
      };
    }
    if (!link.linkedAt) {
      return {
        ok: false,
        code: "persist_unconfirmed",
        message: "No se pudo confirmar la conexión permanente con Google Classroom.",
      };
    }
    return { ok: true, source: "vault" };
  }

  const refresh = String(refreshToken || "").trim();
  if (!refresh) {
    return {
      ok: false,
      code: "missing_refresh_token",
      message:
        "Google no devolvió la autorización necesaria para mantener Classroom conectado. Volvé a conectar Classroom.",
    };
  }

  const saved = isStudent
    ? await api.saveStudentGoogleTokens(uid, { refreshToken: refresh, expiresIn })
    : await api.saveGoogleTokens(uid, { refreshToken: refresh, expiresIn });

  if (!saved?.ok || saved?.skipped) {
    return {
      ok: false,
      code: saved?.skipped ? "persist_skipped" : "persist_failed",
      message: "No se pudo guardar la autorización permanente de Google Classroom.",
    };
  }

  let storedRefresh = null;
  if (isStudent) {
    storedRefresh = await api.getStoredStudentGoogleRefreshToken(uid);
  } else {
    const stored = await api.getStoredGoogleRefreshToken(uid);
    storedRefresh =
      typeof stored === "string" ? stored : stored?.google_refresh_token || null;
  }
  storedRefresh = storedRefresh ? String(storedRefresh).trim() : "";
  if (!storedRefresh || storedRefresh !== refresh) {
    return {
      ok: false,
      code: "persist_unconfirmed",
      message: "No se pudo confirmar la conexión permanente con Google Classroom.",
    };
  }

  const marked = isStudent
    ? await api.markStudentClassroomLinked(uid)
    : await api.markClassroomLinked(uid);

  if (!marked?.ok || marked?.skipped) {
    return {
      ok: false,
      code: marked?.skipped ? "link_skipped" : "link_failed",
      message: "No se pudo confirmar la conexión permanente con Google Classroom.",
    };
  }

  return { ok: true, source: "profiles_legacy" };
}
