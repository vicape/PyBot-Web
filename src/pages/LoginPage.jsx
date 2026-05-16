import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { saveGoogleProfile, getGoogleProfile } from "../authSession.js";

const hasClientId =
  typeof import.meta.env.VITE_GOOGLE_CLIENT_ID === "string" &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim().length > 0;

export default function LoginPage() {
  const navigate = useNavigate();
  const existing = getGoogleProfile();

  return (
    <main className="auth-root">
      <div className="auth-card">
        <h1 className="auth-card__title">PyBot Web</h1>
        <p className="auth-card__lead">
          {hasClientId
            ? "Iniciá sesión con tu cuenta de Google."
            : "Configurá el inicio de sesión con Google para esta instalación."}
        </p>
        <p className="auth-card__muted">
          El IDE sigue disponible sin registro en la página principal.
        </p>
        {existing ? (
          <p className="auth-card__notice">
            Ya hay una sesión guardada en este navegador. Podés ir al panel o cerrar sesión
            allí.
          </p>
        ) : null}
        <div className="auth-card__actions">
          {hasClientId ? (
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
          ) : (
            <>
              <p className="auth-card__codehint">
                Copiá <code>.env.example</code> a <code>.env</code> y definí{" "}
                <code>VITE_GOOGLE_CLIENT_ID</code>. Reiniciá <code>npm run dev</code>.
              </p>
              <button type="button" className="auth-btn auth-btn--primary" disabled>
                Entrar con Google
              </button>
            </>
          )}
          {existing ? (
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
