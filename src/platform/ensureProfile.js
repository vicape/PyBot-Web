import { getSupabase } from "../supabaseClient.js";

/**
 * Garantiza fila en profiles para el usuario de sesión (trigger puede fallar en usuarios viejos).
 */
export async function ensureProfileForUser(user) {
  const sb = getSupabase();
  if (!sb || !user?.id) return { ok: false, error: "no_user" };

  const { data: existing, error: selErr } = await sb
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };
  if (existing?.id) return { ok: true, created: false };

  const meta = user.user_metadata || {};
  const displayName =
    meta.full_name || meta.name || meta.display_name || (user.email ? user.email.split("@")[0] : "Usuario");

  const { error: insErr } = await sb.from("profiles").insert({
    id: user.id,
    email: user.email ?? null,
    display_name: displayName,
    avatar_url: meta.avatar_url || meta.picture || null,
  });

  if (insErr) {
    if (insErr.code === "23505") return { ok: true, created: false };
    return { ok: false, error: insErr.message };
  }
  return { ok: true, created: true };
}
