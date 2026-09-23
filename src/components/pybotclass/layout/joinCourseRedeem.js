import { t } from "../../../i18n.js";

/** Normalización canónica de errores de redeem_org_invite (UI PyBotClass). */
export function redeemErrorMessage(code) {
  switch (code) {
    case "not_found":
      return t("pcJoinInvalidCode");
    case "expired":
      return t("pcJoinExpiredCode");
    case "max_uses":
      return t("pcJoinNoUses");
    case "already_member":
      return t("pcJoinAlreadyMember");
    case "curso_invalido":
      return t("pcJoinInvalidCourse");
    case "empty_code":
      return t("pcJoinEnterCode");
    case "no_session":
      return t("pcJoinNeedLogin");
    default:
      return t("pcJoinFail");
  }
}

/**
 * Canje canónico de invitación (única llamada UI a redeem_org_invite).
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient | null,
 *   code: string,
 *   requireSession?: boolean,
 * }} opts
 * @returns {Promise<
 *   | { status: "empty"; message: string }
 *   | { status: "need_login"; trimmed: string }
 *   | { status: "error"; message: string }
 *   | { status: "ok"; out: object }
 * >}
 */
export async function redeemJoinInvite({ supabase, code, requireSession = false }) {
  const trimmed = code.trim();
  if (!trimmed) {
    return { status: "empty", message: redeemErrorMessage("empty_code") };
  }
  if (!supabase) {
    return { status: "error", message: t("pcJoinFail") };
  }

  if (requireSession) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return { status: "need_login", trimmed };
    }
  }

  const { data: out, error } = await supabase.rpc("redeem_org_invite", {
    invite_code: trimmed,
  });

  if (error) {
    return { status: "error", message: error.message };
  }
  if (!out?.ok) {
    return { status: "error", message: redeemErrorMessage(out?.error) };
  }
  return { status: "ok", out };
}
