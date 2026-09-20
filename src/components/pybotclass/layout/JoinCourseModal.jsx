import { t } from "../../../i18n.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinPathAfterRedeem, joinSuccessMessage } from "../../../platform/redeemOrgInvitePlan.js";
import { roleLabelEs } from "../../../orgRole.js";

function redeemError(code) {
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

export default function JoinCourseModal({ open, onClose, supabase, onJoined }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!open) return null;

  const redeem = async (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || !supabase || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");

    const { data: out, error } = await supabase.rpc("redeem_org_invite", {
      invite_code: trimmed,
    });

    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    if (!out?.ok) {
      setErr(redeemError(out?.error));
      return;
    }

    setMsg(joinSuccessMessage(out, roleLabelEs));
    onJoined?.();
    window.setTimeout(() => {
      onClose?.();
      navigate(joinPathAfterRedeem(out), { replace: false });
    }, 800);
  };

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pbc-modal"
        role="dialog"
        aria-labelledby="join-course-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="join-course-title" className="pbc-modal__title">
          {t("pcJoinCourse")}
        </h2>
        <p className="pbc-modal__step-label">
          {t("pcJoinIntro")}
        </p>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
        {msg ? <p className="pbc-alert pbc-alert--info">{msg}</p> : null}

        <form onSubmit={redeem}>
          <div className="pbc-modal__field">
            <label className="pbc-label" htmlFor="join-code">
              {t("pcInvitationCode")}
            </label>
            <input
              id="join-code"
              className="pbc-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ej. ABC123"
              autoFocus
            />
          </div>
          <div className="pbc-modal__actions">
            <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onClose}>
              {t("pcCancel")}
            </button>
            <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
              {busy ? t("pcJoining") : t("pcJoinCourse")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
