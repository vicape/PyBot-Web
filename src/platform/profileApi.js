import { getSupabase } from "../supabaseClient.js";

/**
 * Lista de columnas opcionales. Si alguna no existe en tu DB (porque no corriste la migración),
 * el código sigue funcionando con las que sí existen.
 */
const PROFILE_COLUMNS_FULL =
  "id, email, display_name, avatar_url, preferred_role, is_super_admin, classroom_linked_at, google_token_expires_at, classroom_student_linked_at, google_student_token_expires_at, ui_theme, ui_background, ui_background_color";
const PROFILE_COLUMNS_FALLBACK = "id, email, display_name, avatar_url";

export async function fetchProfile(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return { profile: null, error: "no_client" };

  // Intentar con todas las columnas
  let { data, error } = await sb
    .from("profiles")
    .select(PROFILE_COLUMNS_FULL)
    .eq("id", userId)
    .maybeSingle();

  // Si alguna columna nueva no existe, degradar al select mínimo
  if (error && error.message && error.message.includes("does not exist")) {
    ({ data, error } = await sb
      .from("profiles")
      .select(PROFILE_COLUMNS_FALLBACK)
      .eq("id", userId)
      .maybeSingle());
  }

  if (error) return { profile: null, error: error.message };
  return { profile: data, error: null };
}

export async function updateProfileDisplayName(userId, displayName) {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };

  const name = String(displayName ?? "").trim();
  if (!name) return { ok: false, error: "El nombre no puede estar vacío." };

  const { error } = await sb.from("profiles").update({ display_name: name }).eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function updatePreferredRole(userId, role) {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };
  if (role !== "teacher" && role !== "student") return { ok: false, error: "invalid_role" };

  const { error } = await sb.from("profiles").update({ preferred_role: role }).eq("id", userId);

  if (error?.message?.includes("preferred_role") || error?.message?.includes("does not exist")) {
    return { ok: true, error: null, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null, skipped: false };
}

/** @deprecated Browser no escribe RT. Solo server (exchange). */
export async function saveGoogleTokens(_userId, _tokens) {
  return { ok: false, error: "server_only", skipped: true };
}

/** @deprecated Browser no escribe RT. Solo server (exchange). */
export async function saveStudentGoogleTokens(_userId, _tokens) {
  return { ok: false, error: "server_only", skipped: true };
}

/**
 * Metadata Classroom docente (sin refresh tokens). Browser-safe.
 * @returns {Promise<{ classroom_linked_at?: string|null, google_token_expires_at?: string|null }|null>}
 */
export async function getStoredClassroomLinkMeta(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return null;

  let { data, error } = await sb
    .from("profiles")
    .select("classroom_linked_at, google_token_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error && error.message && error.message.includes("does not exist")) {
    const fb = await sb
      .from("profiles")
      .select("classroom_linked_at")
      .eq("id", userId)
      .maybeSingle();
    return fb.data ?? null;
  }
  if (error) return null;
  return data ?? null;
}

/**
 * @deprecated No usar desde frontend. Los RT no son legibles en browser.
 * Conservado solo como stub que NUNCA selecciona refresh tokens.
 */
export async function getStoredGoogleRefreshToken(userId) {
  return getStoredClassroomLinkMeta(userId);
}

/** Metadata Classroom alumno (sin refresh tokens). */
export async function getStoredStudentClassroomLink(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("classroom_student_linked_at, google_student_token_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error?.message?.includes("does not exist")) return null;
  if (error) return null;
  return data ?? null;
}

/**
 * @deprecated No devolver RT. Stub metadata-only.
 */
export async function getStoredStudentGoogleRefreshToken(userId) {
  const link = await getStoredStudentClassroomLink(userId);
  return null;
}

export async function markClassroomLinked(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };

  const { error } = await sb
    .from("profiles")
    .update({ classroom_linked_at: new Date().toISOString() })
    .eq("id", userId);

  if (error?.message?.includes("classroom_linked_at") || error?.message?.includes("does not exist")) {
    return { ok: true, error: null, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null, skipped: false };
}

export async function markStudentClassroomLinked(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };

  const { error } = await sb
    .from("profiles")
    .update({ classroom_student_linked_at: new Date().toISOString() })
    .eq("id", userId);

  if (
    error?.message?.includes("classroom_student_linked_at") ||
    error?.message?.includes("does not exist")
  ) {
    return { ok: true, error: null, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null, skipped: false };
}

/**
 * Lista links Classroom org-scoped del usuario (metadata sin RT).
 */
export async function listOrganizationClassroomLinks(userId, mode = "teacher") {
  const sb = getSupabase();
  const uid = String(userId || "").trim();
  const m = mode === "student" ? "student" : "teacher";
  if (!sb || !uid) return { rows: [], error: "missing_args" };

  const { data, error } = await sb
    .from("organization_classroom_links")
    .select("org_id, mode, classroom_linked_at, google_token_expires_at")
    .eq("user_id", uid)
    .eq("mode", m);

  if (error?.message?.includes("does not exist") || error?.code === "42P01") {
    return { rows: [], error: null, skipped: true };
  }
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

/**
 * Metadata de vínculo Classroom por org (P5/P16). Sin refresh tokens.
 * @param {string} userId
 * @param {string} orgId
 * @param {"teacher"|"student"} [mode="teacher"]
 */
export async function fetchOrganizationClassroomLink(userId, orgId, mode = "teacher") {
  const sb = getSupabase();
  const uid = String(userId || "").trim();
  const oid = String(orgId || "").trim();
  const m = mode === "student" ? "student" : "teacher";
  if (!sb || !uid || !oid) return { ok: false, linkedAt: null, error: "missing_args" };

  const { data, error } = await sb
    .from("organization_classroom_links")
    .select("classroom_linked_at, google_token_expires_at, mode, org_id")
    .eq("user_id", uid)
    .eq("org_id", oid)
    .eq("mode", m)
    .maybeSingle();

  if (error?.message?.includes("does not exist") || error?.code === "42P01") {
    return { ok: false, linkedAt: null, error: "links_unavailable", skipped: true };
  }
  if (error) return { ok: false, linkedAt: null, error: error.message };
  return {
    ok: true,
    linkedAt: data?.classroom_linked_at ?? null,
    expiresAt: data?.google_token_expires_at ?? null,
    error: null,
  };
}

/**
 * Quita credenciales Classroom del perfil (legacy P15). No cierra sesión PyBot ni borra cursos.
 * @param {string} userId
 * @param {"teacher"|"student"|"both"} [mode="both"]
 */
export async function clearClassroomTokens(userId, mode = "both") {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };

  const patch = {};
  if (mode === "teacher" || mode === "both") {
    patch.google_refresh_token = null;
    patch.google_token_expires_at = null;
    patch.classroom_linked_at = null;
  }
  if (mode === "student" || mode === "both") {
    patch.google_student_refresh_token = null;
    patch.google_student_token_expires_at = null;
    patch.classroom_student_linked_at = null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("profiles").update(patch).eq("id", userId);
  if (
    error?.message?.includes("does not exist") ||
    error?.message?.includes("google_refresh_token") ||
    error?.message?.includes("google_student")
  ) {
    return { ok: true, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
