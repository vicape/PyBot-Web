import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinPathAfterRedeem, joinSuccessMessage } from "../../../platform/redeemOrgInvitePlan.js";
import { roleLabelEs } from "../../../orgRole.js";

function redeemErrorEs(code) {
  switch (code) {
    case "not_found":
      return "El código no es válido.";
    case "expired":
      return "Este código expiró.";
    case "max_uses":
      return "Este código ya no tiene usos disponibles.";
    case "already_member":
      return "Ya sos miembro de esta institución.";
    case "curso_invalido":
      return "El curso de esta invitación no es válido.";
    case "empty_code":
      return "Ingresá un código.";
    case "no_session":
      return "Tenés que iniciar sesión primero.";
    default:
      return "No se pudo unir al curso.";
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
      setErr(redeemErrorEs(out?.error));
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
          Unirme a un curso
        </h2>
        <p className="pbc-modal__step-label">
          Ingresá el código o enlace de invitación. La institución se asigna automáticamente.
        </p>

        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
        {msg ? <p className="pbc-alert pbc-alert--info">{msg}</p> : null}

        <form onSubmit={redeem}>
          <div className="pbc-modal__field">
            <label className="pbc-label" htmlFor="join-code">
              Código de invitación
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
              Cancelar
            </button>
            <button type="submit" className="pbc-btn pbc-btn--primary" disabled={busy}>
              {busy ? "Uniendo…" : "Unirme"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
