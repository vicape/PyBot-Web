import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { baseLoginOAuthOptions } from "../platform/googleOAuth.js";
import "../styles/dashboard-theme.css";

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();
  const supabaseConfigured = isSupabaseConfigured();

  useEffect(() => {
    if (!supabaseConfigured) return;
    const sb = getSupabase();
    if (!sb) return;

    let cancelled = false;
    sb.auth.getSession().then(({ data }) => {
      if (cancelled || !data?.session?.user) return;
      const next = new URLSearchParams(window.location.search).get("next");
      const dest =
        typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard/classes";
      navigate(dest, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseConfigured, navigate]);

  const oauthSupabaseGoogle = async () => {
    const sb = getSupabase();
    if (!sb) return;

    try {
      const next = new URLSearchParams(window.location.search).get("next");
      if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
        sessionStorage.setItem("pybot_oauth_next", next);
      } else {
        sessionStorage.removeItem("pybot_oauth_next");
      }
    } catch {
      //
    }

    const redirectTo = `${window.location.origin}/auth/callback`;
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: baseLoginOAuthOptions(redirectTo),
    });
  };

  const showGIS = !supabaseConfigured && hasClientId;
  const showStub = !supabaseConfigured && !hasClientId;

  return (
    <main className="auth-root auth-root--pbc">
      <div className="auth-card auth-card--login auth-card--pbc">
        <div className="auth-card__brand">PyBotClass</div>
        <p className="auth-card__tagline">PyBot Web · Tecnología · Educación</p>
        <p className="auth-card__lead">
          {supabaseConfigured
            ? "Una cuenta por email. Entrá con Google para usar PyBotClass."
            : hasClientId
              ? "Iniciá sesión con tu cuenta de Google."
              : "Configurá el inicio de sesión con Google para esta instalación."}
        </p>
        <p className="auth-card__muted">
          El IDE sigue disponible sin registro en la{" "}
          <Link to="/">página principal</Link>.
        </p>

        {existing && !supabaseConfigured ? (
          <p className="auth-card__notice">
            Ya hay una sesión guardada en este navegador. Podés ir al panel o cerrar sesión allí.
          </p>
        ) : null}

        <div className="auth-card__actions">
          {supabaseConfigured ? (
            <button type="button" className="auth-btn auth-btn--primary" onClick={oauthSupabaseGoogle}>
              Continuar con Google
            </button>
          ) : null}
          {showGIS ? (
            <div className="auth-google-wrap">
              <GoogleLogin
                onSuccess={(res) => {
                  const cred = res.credential;
                  if (cred && saveGoogleProfile(cred)) navigate("/dashboard/classes", { replace: true });
                }}
                onError={() => {}}
                theme="filled_blue"
                size="large"
                text="signin_with"
                shape="rectangular"
                width={384}
              />
            </div>
          ) : null}
          {showStub ? (
            <>
              <p className="auth-card__codehint">
                Copiá <code>.env.example</code> a <code>.env</code> y definí{" "}
                <code>VITE_GOOGLE_CLIENT_ID</code> <em>o</em> Supabase (<code>VITE_SUPABASE_*</code>).
                Reiniciá <code>npm run dev</code>.
              </p>
              <button type="button" className="auth-btn auth-btn--primary" disabled>
                Entrar con Google
              </button>
            </>
          ) : null}
          {existing && !supabaseConfigured ? (
            <Link to="/dashboard/classes" className="auth-link">
              Ir a PyBotClass
            </Link>
          ) : null}
          <Link to="/" className="auth-link">
            Volver al IDE
          </Link>
        </div>

        {supabaseConfigured ? (
          <p className="auth-classroom-hint">
            Google Classroom se conecta después, cuando elijas importar cursos.
          </p>
        ) : null}
      </div>
    </main>
  );
}
