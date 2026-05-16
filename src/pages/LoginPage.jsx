import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();
  const supabaseConfigured = isSupabaseConfigured();

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
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
  };

  const showGIS = !supabaseConfigured && hasClientId;
  const showStub = !supabaseConfigured && !hasClientId;

  return (
    <main className="auth-root">
      <div className="auth-card">
        <h1 className="auth-card__title">PyBot Web</h1>
        <p className="auth-card__lead">
          {supabaseConfigured
            ? "Iniciá sesión con Google para crear o gestionar tus colegios en la plataforma."
            : hasClientId
              ? "Iniciá sesión con tu cuenta de Google."
              : "Configurá el inicio de sesión con Google para esta instalación."}
        </p>
        <p className="auth-card__muted">
          El IDE sigue disponible sin registro en la página principal.
        </p>
        {existing && !supabaseConfigured ? (
          <p className="auth-card__notice">
            Ya hay una sesión guardada en este navegador. Podés ir al panel o cerrar sesión
            allí.
          </p>
        ) : null}
        <div className="auth-card__actions">
          {supabaseConfigured ? (
            <>
              <button type="button" className="auth-btn auth-btn--primary" onClick={oauthSupabaseGoogle}>
                Continuar con Google
              </button>
              <p className="auth-card__codehint">
                Requiere proyecto Supabase: ejecutá el SQL de{" "}
                <code>supabase/migrations/</code> y activá el proveedor Google en Authentication.
              </p>
            </>
          ) : null}
          {showGIS ? (
            <div className="auth-google-wrap">
              <GoogleLogin
                onSuccess={(res) => {
                  const cred = res.credential;
                  if (cred && saveGoogleProfile(cred)) navigate("/dashboard", { replace: true });
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
            <Link to="/dashboard" className="auth-link">
              Ir al panel
            </Link>
          ) : null}
          <Link to="/" className="auth-link">
            Volver al IDE
          </Link>
        </div>
      </div>
    </main>
  );
}
