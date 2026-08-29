import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { roleLabelEs } from "../orgRole.js";
import {
  joinPathAfterRedeem,
  joinSuccessMessage,
} from "../platform/redeemOrgInvitePlan.js";

function redeemErrorEs(code) {
  switch (code) {
    case "not_found":
      return "El código no es válido.";
    case "expired":
      return "Este código expiró.";
    case "max_uses":
      return "Este código ya no tiene usos disponibles.";
    case "already_member":
      return "Ya sos miembro de este colegio.";
    case "curso_invalido":
      return "El curso de esta invitación no es válido.";
    case "empty_code":
      return "Ingresá un código.";
    case "no_session":
      return "Tenés que iniciar sesión primero.";
    default:
      return "No se pudo unir el colegio.";
  }
}

export default function JoinOrgPage() {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c);
  }, [searchParams]);

  const redeem = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setMsg("Ingresá un código.");
      return;
    }
    if (!isSupabaseConfigured() || !supabase) {
      setMsg("Supabase no está configurado.");
      return;
    }
    setBusy(true);
    setMsg("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      const next = `/join?code=${encodeURIComponent(code.trim())}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: false });
      return;
    }

    const { data: out, error } = await supabase.rpc("redeem_org_invite", {
      invite_code: trimmed,
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    if (!out?.ok) {
      setMsg(redeemErrorEs(out?.error));
      return;
    }
    setMsg(joinSuccessMessage(out, roleLabelEs));
    window.setTimeout(() => {
      navigate(joinPathAfterRedeem(out), { replace: true });
    }, 900);
  }, [code, navigate, supabase]);

  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-card__title">Unirse a un colegio</h1>
        <p className="auth-card__lead">
          Pedile a tu docente el enlace o el código de invitación (alumno o docente).
        </p>
        <label className="auth-org-label" htmlFor="invite-code">
          Código de invitación
        </label>
        <input
          id="invite-code"
          className="auth-org-input auth-org-input--block"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Ej. a1b2c3d4e5f6g7"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        {msg ? <p className="auth-card__notice">{msg}</p> : null}
        <button type="button" className="auth-btn auth-btn--primary" onClick={() => void redeem()} disabled={busy}>
          {busy ? "Procesando…" : !code.trim() ? "Ingresá un código o abrí el enlace" : "Unirme"}
        </button>
        <p className="auth-card__muted">
          Primera vez: si creás el colegio vos, quedás como gestión ({roleLabelEs("owner")}); no hace falta código.
        </p>
        <Link to="/dashboard" className="auth-link">
          Volver al panel
        </Link>
      </div>
    </main>
  );
}
