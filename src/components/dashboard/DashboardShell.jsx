import { Link } from "react-router-dom";

const TABS = [
  { id: "home", label: "Inicio" },
  { id: "schools", label: "Colegios", flag: "showSchoolsTab" },
  { id: "courses", label: "Mis cursos", flag: "showCoursesTab" },
  { id: "classroom", label: "Classroom", flag: "showClassroomTab" },
  { id: "account", label: "Cuenta" },
];

export default function DashboardShell({
  activeTab,
  onTabChange,
  showSchoolsTab = false,
  showCoursesTab = false,
  showClassroomTab = false,
  showAdminTab = false,
  adminActive = false,
  wideBody = false,
  /** @deprecated usar showSchoolsTab/showCoursesTab */
  studentView,
  userName,
  userEmail,
  userPicture,
  onSignOut,
  children,
}) {
  // Compat: studentView true = solo alumno; false = solo staff (legado)
  let schools = showSchoolsTab;
  let courses = showCoursesTab;
  let classroom = showClassroomTab;
  if (typeof studentView === "boolean" && !showSchoolsTab && !showCoursesTab) {
    schools = !studentView;
    courses = studentView;
    classroom = showClassroomTab && !studentView;
  }

  const flags = {
    showSchoolsTab: schools,
    showCoursesTab: courses,
    showClassroomTab: classroom,
  };

  const visibleTabs = TABS.filter((t) => !t.flag || flags[t.flag]);

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
        {showAdminTab ? (
          <Link
            to="/dashboard/admin"
            className={`dash-nav__tab dash-nav__tab--link ${adminActive ? "dash-nav__tab--active" : ""}`}
          >
            Admin
          </Link>
        ) : null}
      </nav>

      <div className={`dash-body${wideBody ? " dash-body--wide" : ""}`}>{children}</div>
    </main>
  );
}
