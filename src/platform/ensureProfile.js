import { getSupabase } from "../supabaseClient.js";
import { isValidSignupRole } from "./signupRole.js";

/**
 * Garantiza fila en profiles para el usuario de sesión (trigger puede fallar en usuarios viejos).
 */
export async function ensureProfileForUser(user, preferredRole = null) {
  const sb = getSupabase();
  if (!sb || !user?.id) return { ok: false, error: "no_user" };

  const role = isValidSignupRole(preferredRole) ? preferredRole : null;

  const { data: existing, error: selErr } = await sb
    .from("profiles")
    .select("id, preferred_role")
    .eq("id", user.id)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };
  if (existing?.id) {
    if (role && !existing.preferred_role) {
      await sb.from("profiles").update({ preferred_role: role }).eq("id", user.id);
    }
    return { ok: true, created: false };
  }

  const meta = user.user_metadata || {};
  const displayName =
    meta.full_name || meta.name || meta.display_name || (user.email ? user.email.split("@")[0] : "Usuario");

  const row = {
    id: user.id,
    email: user.email ?? null,
    display_name: displayName,
    avatar_url: meta.avatar_url || meta.picture || null,
  };
  if (role) row.preferred_role = role;

  const { error: insErr } = await sb.from("profiles").insert(row);

  if (insErr) {
    if (insErr.code === "23505") return { ok: true, created: false };
    return { ok: false, error: insErr.message };
  }
  return { ok: true, created: true };
}
