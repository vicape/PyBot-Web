import { getSupabase } from "../supabaseClient.js";

export async function fetchProfile(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return { profile: null, error: "no_client" };

  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
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
