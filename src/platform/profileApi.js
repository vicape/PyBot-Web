import { getSupabase } from "../supabaseClient.js";

/**
 * Lista de columnas opcionales. Si alguna no existe en tu DB (porque no corriste la migración),
 * el código sigue funcionando con las que sí existen.
 */
const PROFILE_COLUMNS_FULL =
  "id, email, display_name, avatar_url, preferred_role, is_super_admin, classroom_linked_at, google_refresh_token, google_token_expires_at, ui_theme, ui_background, ui_background_color";
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

export async function saveGoogleTokens(userId, { accessToken, refreshToken, expiresIn }) {
  const sb = getSupabase();
  if (!sb || !userId) return { ok: false, error: "no_client" };

  const patch = {};
  if (refreshToken) patch.google_refresh_token = refreshToken;
  if (expiresIn) {
    patch.google_token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("profiles").update(patch).eq("id", userId);

  // Las columnas nuevas no existen aún → no romper el flujo
  if (error?.message?.includes("does not exist") ||
      error?.message?.includes("google_refresh_token") ||
      error?.message?.includes("google_token_expires")) {
    return { ok: true, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getStoredGoogleRefreshToken(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return null;

  // Intentar con columnas nuevas + classroom_linked_at
  let { data, error } = await sb
    .from("profiles")
    .select("google_refresh_token, google_token_expires_at, classroom_linked_at")
    .eq("id", userId)
    .maybeSingle();

  if (error && error.message && error.message.includes("does not exist")) {
    // Las columnas nuevas no existen → usar solo classroom_linked_at
    const fb = await sb
      .from("profiles")
      .select("classroom_linked_at")
      .eq("id", userId)
      .maybeSingle();
    return fb.data ?? null;
  }

  return data ?? null;
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
