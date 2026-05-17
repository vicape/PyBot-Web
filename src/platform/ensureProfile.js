import { getSupabase } from "../supabaseClient.js";
import { isValidSignupRole } from "./signupRole.js";

/**
 * Garantiza fila en profiles para el usuario de sesión (trigger puede fallar en usuarios viejos).
 */
export async function ensureProfileForUser(user, preferredRole = null) {
  const sb = getSupabase();
  if (!sb || !user?.id) return { ok: false, error: "no_user" };

  const role = isValidSignupRole(preferredRole) ? preferredRole : null;

  let { data: existing, error: selErr } = await sb
    .from("profiles")
    .select("id, preferred_role")
    .eq("id", user.id)
    .maybeSingle();

  // Si preferred_role no existe, intentar solo con id
  if (selErr?.message?.includes("does not exist")) {
    ({ data: existing, error: selErr } = await sb
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle());
  }

  if (selErr) return { ok: false, error: selErr.message };
  if (existing?.id) {
    if (role && !existing.preferred_role) {
      const { error: updErr } = await sb
        .from("profiles")
        .update({ preferred_role: role })
        .eq("id", user.id);
      // Si la columna no existe, ignorar silenciosamente
      if (updErr && !updErr.message?.includes("does not exist")) {
        // Otros errores: no bloquear el flujo
      }
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

  let { error: insErr } = await sb.from("profiles").insert(row);

  // Si la columna preferred_role no existe, reintentar sin ella
  if (insErr?.message?.includes("does not exist") && row.preferred_role) {
    const { preferred_role: _omit, ...rowWithoutRole } = row;
    ({ error: insErr } = await sb.from("profiles").insert(rowWithoutRole));
  }

  if (insErr) {
    if (insErr.code === "23505") return { ok: true, created: false };
    return { ok: false, error: insErr.message };
  }
  return { ok: true, created: true };
}
