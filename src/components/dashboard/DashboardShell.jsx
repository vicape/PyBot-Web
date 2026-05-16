import { Link } from "react-router-dom";

const TABS = [
  { id: "home", label: "Inicio" },
  { id: "schools", label: "Colegios" },
  { id: "account", label: "Cuenta" },
  { id: "classroom", label: "Classroom", teacherOnly: true },
];

export default function DashboardShell({
  activeTab,
  onTabChange,
  showClassroomTab,
  userName,
  userEmail,
  userPicture,
  onSignOut,
  children,
}) {
  const visibleTabs = TABS.filter((t) => !t.teacherOnly || showClassroomTab);

  return (
    <main className="dash-root">
      <header className="dash-header">
        <div className="dash-header__brand">
          <Link to="/" className="dash-header__logo">
            PyBot
          </Link>
          <span className="dash-header__tag">Panel</span>
        </div>
        <div className="dash-header__user">
          {userPicture ? (
            <img src={userPicture} alt="" className="dash-header__avatar" width={40} height={40} />
          ) : (
            <div className="dash-header__avatar dash-header__avatar--letter" aria-hidden>
              {(userName || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="dash-header__user-text">
            <strong>{userName}</strong>
            {userEmail ? <span>{userEmail}</span> : null}
          </div>
          <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={onSignOut}>
            Salir
          </button>
        </div>
      </header>

      <nav className="dash-nav" aria-label="Secciones del panel">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`dash-nav__tab ${activeTab === tab.id ? "dash-nav__tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="dash-body">{children}</div>
    </main>
  );
}
