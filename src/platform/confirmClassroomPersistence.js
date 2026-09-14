/**
 * Confirmación de persistencia de OAuth Classroom (teacher/student).
 * No marca vinculado hasta verificar refresh token leíble y coincidente.
 */

import {
  saveGoogleTokens,
  saveStudentGoogleTokens,
  markClassroomLinked,
  markStudentClassroomLinked,
  getStoredGoogleRefreshToken,
  getStoredStudentGoogleRefreshToken,
} from "./profileApi.js";

/**
 * @param {{
 *   userId: string,
 *   mode: "teacher"|"student",
 *   refreshToken: string,
 *   expiresIn?: number,
 * }} args
 * @param {object} [api] inyección opcional para tests
 * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
 */
export async function confirmClassroomPersistence(
  { userId, mode, refreshToken, expiresIn },
  api = {
    saveGoogleTokens,
    saveStudentGoogleTokens,
    markClassroomLinked,
    markStudentClassroomLinked,
    getStoredGoogleRefreshToken,
    getStoredStudentGoogleRefreshToken,
  },
) {
  const uid = String(userId || "").trim();
  const refresh = String(refreshToken || "").trim();
  if (!uid) {
    return {
      ok: false,
      code: "missing_user",
      message: "No se pudo confirmar la conexión permanente con Google Classroom.",
    };
  }
  if (!refresh) {
    return {
      ok: false,
      code: "missing_refresh_token",
      message:
        "Google no devolvió la autorización necesaria para mantener Classroom conectado. Volvé a conectar Classroom.",
    };
  }

  const isStudent = mode === "student";

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

  return { ok: true };
}
