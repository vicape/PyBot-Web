import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { roleLabelEs } from "../orgRole.js";
import {
  applyAppearanceToElement,
  loadAppearanceFromStorage,
  normalizeAppearance,
} from "../platform/appearanceApi.js";
import {
  joinPathAfterRedeem,
  joinSuccessMessage,
} from "../platform/redeemOrgInvitePlan.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

import "../styles/dashboard-theme.css";
import "../styles/pybotclass-dashboard.css";

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

/** Shell mínimo pbc-* para flujo de invitación sin sesión (sin forzar login). */
function JoinGuestShell({ children }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const appearance =
      loadAppearanceFromStorage("anon") ?? normalizeAppearance({ theme: "system" });
    applyAppearanceToElement(el, appearance);

    if (appearance.theme !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearanceToElement(el, appearance);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="pbc-dashboard" ref={containerRef} data-pybot-theme="pbc">
      <div className="pbc-dashboard__main">
        <div className="pbc-dashboard__content">{children}</div>
      </div>
    </div>
  );
}

function JoinForm({ code, setCode, busy, msg, msgKind, onRedeem }) {
  return (
    <div className="pbc-join-page">
      <header className="pbc-hero-block" style={{ marginBottom: "1.25rem" }}>
        <div>
          <h1 className="pbc-hero-block__title">Unirme a un curso</h1>
          <p className="pbc-hero-block__subtitle">
            Pedile a tu docente el enlace o el código de invitación. La institución se asigna sola.
          </p>
        </div>
      </header>

      <div className="pbc-panel-card">
        {msg ? (
          <p className={`pbc-alert pbc-alert--${msgKind === "error" ? "error" : "info"}`}>{msg}</p>
        ) : null}

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="invite-code">
            Código de invitación
          </label>
          <input
            id="invite-code"
            className="pbc-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Ej. a1b2c3d4e5f6g7"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>

        <div className="pbc-modal__actions">
          <button
            type="button"
            className="pbc-btn pbc-btn--primary"
            onClick={() => void onRedeem()}
            disabled={busy}
          >
            {busy ? "Procesando…" : !code.trim() ? "Ingresá un código o abrí el enlace" : "Unirme"}
          </button>
        </div>

        <p className="pbc-panel-card__hint">
          Si creás la institución vos, quedás como gestión ({roleLabelEs("owner")}); no hace falta
          código.
        </p>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Link to="/dashboard/classes" className="pbc-btn pbc-btn--ghost">
          Volver a PyBotClass
        </Link>
      </div>
    </div>
  );
}

export default function JoinOrgPage() {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState("info");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c);
  }, [searchParams]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setAuthReady(true);
      return undefined;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data?.session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const redeem = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setMsgKind("error");
      setMsg("Ingresá un código.");
      return;
    }
    if (!isSupabaseConfigured() || !supabase) {
      setMsgKind("error");
      setMsg("Supabase no está configurado.");
      return;
    }
    setBusy(true);
    setMsg("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
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
      setMsgKind("error");
      setMsg(error.message);
      return;
    }
    if (!out?.ok) {
      setMsgKind("error");
      setMsg(redeemErrorEs(out?.error));
      return;
    }
    setMsgKind("info");
    setMsg(joinSuccessMessage(out, roleLabelEs));
    window.setTimeout(() => {
      navigate(joinPathAfterRedeem(out), { replace: true });
    }, 900);
  }, [code, navigate, supabase]);

  const form = (
    <JoinForm
      code={code}
      setCode={setCode}
      busy={busy}
      msg={msg}
      msgKind={msgKind}
      onRedeem={redeem}
    />
  );

  if (!authReady) {
    return (
      <main className="dash-root dash-root--center">
        <p>Cargando…</p>
      </main>
    );
  }

  if (user) {
    return (
      <PyBotClassLayout user={user} hideSearch onSignOut={() => void signOut()}>
        {form}
      </PyBotClassLayout>
    );
  }

  return <JoinGuestShell>{form}</JoinGuestShell>;
}
