/**
 * Confirmación de persistencia OAuth Classroom (P2 / P5/P16).
 * El browser NUNCA recibe ni confirma refresh tokens.
 * Solo verifica metadata (organization_classroom_links o linked_at legacy).
 */

import {
  fetchOrganizationClassroomLink,
  getStoredClassroomLinkMeta,
  getStoredStudentClassroomLink,
} from "./profileApi.js";

/**
 * @param {{
 *   userId: string,
 *   mode: "teacher"|"student",
 *   orgId?: string|null,
 *   serverPersisted?: boolean,
 *   source?: string|null,
 * }} args
 * @param {object} [api]
 */
export async function confirmClassroomPersistence(
  { userId, mode, orgId, serverPersisted = true, source = null },
  api = {
    fetchOrganizationClassroomLink,
    getStoredClassroomLinkMeta,
    getStoredStudentClassroomLink,
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

  if (!serverPersisted) {
    return {
      ok: false,
      code: "server_persist_required",
      message: "La autorización de Classroom debe persistirse en el servidor.",
    };
  }

  const isStudent = mode === "student";
  const oid = typeof orgId === "string" ? orgId.trim() : "";
  const src = source || "vault";

  if (oid && src !== "profiles_legacy") {
    const link = await api.fetchOrganizationClassroomLink(uid, oid, mode);
    if (link?.ok && link.linkedAt) {
      return { ok: true, source: "vault" };
    }
    // Fallback: legacy metadata if links table empty during dual-write
  }

  if (isStudent) {
    const meta = await api.getStoredStudentClassroomLink(uid);
    if (meta?.classroom_student_linked_at) {
      return { ok: true, source: "profiles_legacy" };
    }
  } else {
    const meta = await api.getStoredClassroomLinkMeta(uid);
    if (meta?.classroom_linked_at) {
      return { ok: true, source: "profiles_legacy" };
    }
  }

  // Vault path with org: require link row
  if (oid) {
    const link = await api.fetchOrganizationClassroomLink(uid, oid, mode);
    if (link?.ok && link.linkedAt) {
      return { ok: true, source: "vault" };
    }
  }

  return {
    ok: false,
    code: "persist_unconfirmed",
    message: "No se pudo confirmar la conexión permanente con Google Classroom.",
  };
}
