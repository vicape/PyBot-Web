import { Link, useNavigate } from "react-router-dom";
import { getGoogleProfile } from "../authSession.js";
import { signOutGoogleClient } from "../authGoogle.js";

export default function DashboardPage() {
  const navigate = useNavigate();
  const profile = getGoogleProfile();

  const onSignOut = () => {
    signOutGoogleClient();
    navigate("/login", { replace: true });
  };

  if (!profile) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Panel</h1>
          <p className="auth-card__lead">No hay sesión iniciada en este navegador.</p>
          <div className="auth-card__actions">
            <Link to="/login" className="auth-btn auth-btn--ghost">
              Ir a login
            </Link>
            <Link to="/" className="auth-link">
              Abrir IDE
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-card__title">Panel</h1>
        <p className="auth-card__lead">Sesión iniciada (MVP en el navegador).</p>
        <div className="auth-profile">
          {profile.picture ? (
            <img src={profile.picture} alt="" className="auth-profile__avatar" width={56} height={56} />
          ) : null}
          <div className="auth-profile__text">
            <strong>{profile.name || "Usuario"}</strong>
            {profile.email ? <span className="auth-profile__email">{profile.email}</span> : null}
          </div>
        </div>
        <p className="auth-card__muted">
          Aquí irá el panel docente, cursos y Classroom. Por ahora solo se guarda el perfil en
          este dispositivo.
        </p>
        <div className="auth-card__actions auth-card__actions--row">
          <Link to="/" className="auth-btn auth-btn--ghost">
            Abrir IDE
          </Link>
          <button type="button" className="auth-btn auth-btn--primary" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}
