import { t } from "../../../i18n.js";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinPathAfterRedeem } from "../../../platform/redeemOrgInvitePlan.js";
import { redeemJoinInvite } from "./joinCourseRedeem.js";

/**
 * Controlador canónico del flujo unirse a curso (estado + submit + post-redeem).
 */
export function useJoinCourse({
  supabase,
  initialCode = "",
  requireSession = false,
  navigateReplace = false,
  successDelayMs = 800,
  onJoined,
  onClose,
  onNeedLogin,
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (busy) return;
      if (!requireSession && (!supabase || !code.trim())) return;

      setBusy(true);
      setErr("");
      setMsg("");

      const result = await redeemJoinInvite({ supabase, code, requireSession });
      setBusy(false);

      if (result.status === "empty") {
        setErr(result.message);
        return;
      }
      if (result.status === "need_login") {
        onNeedLogin?.(result.trimmed);
        return;
      }
      if (result.status === "error") {
        setErr(result.message);
        return;
      }
      if (result.status !== "ok") return;

      setMsg(t("pcJoinSuccess"));
      onJoined?.();
      window.setTimeout(() => {
        onClose?.();
        navigate(joinPathAfterRedeem(result.out), { replace: navigateReplace });
      }, successDelayMs);
    },
    [
      busy,
      code,
      navigate,
      navigateReplace,
      onClose,
      onJoined,
      onNeedLogin,
      requireSession,
      successDelayMs,
      supabase,
    ],
  );

  return { code, setCode, busy, msg, err, submit };
}
