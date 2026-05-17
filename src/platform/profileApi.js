import { getSupabase } from "../supabaseClient.js";

export async function fetchProfile(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return { profile: null, error: "no_client" };

  const { data, error } = await sb
    .from("profiles")
    .select("id, email, display_name, avatar_url, preferred_role, classroom_linked_at, google_token_expires_at")
    .eq("id", userId)
    .maybeSingle();
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

  if (error?.message?.includes("preferred_role")) {
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
  if (accessToken && expiresIn) {
    patch.google_token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from("profiles").update(patch).eq("id", userId);
  if (error?.message?.includes("google_refresh_token") || error?.message?.includes("google_token_expires")) {
    return { ok: true, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getStoredGoogleRefreshToken(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return null;

  // Intentar con columnas nuevas + classroom_linked_at
  const { data, error } = await sb
    .from("profiles")
    .select("google_refresh_token, google_token_expires_at, classroom_linked_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Si las columnas nuevas no existen todavía, intentar solo con classroom_linked_at
    const fallback = await sb
      .from("profiles")
      .select("classroom_linked_at")
      .eq("id", userId)
      .maybeSingle();
    return fallback.data ?? null;
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

  if (error?.message?.includes("classroom_linked_at")) {
    return { ok: true, error: null, skipped: true };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null, skipped: false };
}
