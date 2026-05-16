import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import { SIGNUP_ROLES, setSignupRole, signupRoleLabelEs } from "../platform/signupRole.js";

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();
  const supabaseConfigured = isSupabaseConfigured();
  const [role, setRole] = useState(null);

  const oauthSupabaseGoogle = async () => {
    if (!role) return;
    const sb = getSupabase();
    if (!sb) return;

    setSignupRole(role);

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
      <div className="auth-card auth-card--login">
        <h1 className="auth-card__title">PyBot Web</h1>
        <p className="auth-card__lead">
          {supabaseConfigured
            ? "Elegí tu perfil y entrá con Google para usar colegios, cursos y Classroom."
            : hasClientId
              ? "Iniciá sesión con tu cuenta de Google."
              : "Configurá el inicio de sesión con Google para esta instalación."}
        </p>
        <p className="auth-card__muted">
          El IDE sigue disponible sin registro en la{" "}
          <Link to="/">página principal</Link>.
        </p>

        {supabaseConfigured ? (
          <>
            <p className="auth-role-label">¿Cómo vas a usar PyBot?</p>
            <div className="auth-role-grid" role="radiogroup" aria-label="Perfil">
              <button
                type="button"
                role="radio"
                aria-checked={role === SIGNUP_ROLES.teacher}
                className={`auth-role-card${role === SIGNUP_ROLES.teacher ? " auth-role-card--active" : ""}`}
                onClick={() => setRole(SIGNUP_ROLES.teacher)}
              >
                <span className="auth-role-card__icon" aria-hidden>
                  👩‍🏫
                </span>
                <span className="auth-role-card__title">Soy docente</span>
                <span className="auth-role-card__desc">
                  Creo colegios, cursos y actividades. Puedo vincular Google Classroom.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === SIGNUP_ROLES.student}
                className={`auth-role-card${role === SIGNUP_ROLES.student ? " auth-role-card--active" : ""}`}
                onClick={() => setRole(SIGNUP_ROLES.student)}
              >
                <span className="auth-role-card__icon" aria-hidden>
                  🎓
                </span>
                <span className="auth-role-card__title">Soy alumno</span>
                <span className="auth-role-card__desc">
                  Me uno a un colegio con código de invitación y hago las actividades.
                </span>
              </button>
            </div>
          </>
        ) : null}

        {existing && !supabaseConfigured ? (
          <p className="auth-card__notice">
            Ya hay una sesión guardada en este navegador. Podés ir al panel o cerrar sesión allí.
          </p>
        ) : null}

        <div className="auth-card__actions">
          {supabaseConfigured ? (
            <button
              type="button"
              className="auth-btn auth-btn--primary"
              onClick={oauthSupabaseGoogle}
              disabled={!role}
            >
              {role
                ? `Continuar con Google como ${signupRoleLabelEs(role)}`
                : "Elegí docente o alumno arriba"}
            </button>
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
