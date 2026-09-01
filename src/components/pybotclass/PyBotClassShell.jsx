import { Link } from "react-router-dom";
import DashboardShell from "../dashboard/DashboardShell.jsx";

export default function PyBotClassShell({
  user,
  showAdminTab = false,
  adminActive = false,
  onSignOut,
  children,
}) {
  const meta = user?.user_metadata || {};
  const name =
    meta.full_name || meta.name || meta.display_name || user?.email?.split("@")[0] || "Usuario";
  const picture = meta.avatar_url || meta.picture || null;

  return (
    <DashboardShell
      activeTab="pybotclass"
      onTabChange={(tabId) => {
        if (tabId === "home") window.location.href = "/";
        else if (tabId === "account") window.location.href = "/dashboard?tab=account";
        else if (tabId === "pybotclass") window.location.href = "/dashboard/classes";
      }}
      showPyBotClassTab
      showAdminTab={showAdminTab}
      adminActive={adminActive}
      wideBody
      userName={name}
      userEmail={user?.email}
      userPicture={picture}
      onSignOut={onSignOut}
    >
      <section className="dash-panel">{children}</section>
    </DashboardShell>
  );
}

export function PyBotClassBreadcrumb({ items }) {
  return (
    <p className="auth-breadcrumb">
      <Link to="/dashboard/classes" className="auth-link">
        PyBotClass
      </Link>
      {items.map((item, i) => (
        <span key={item.href || item.label || i}>
          <span aria-hidden> / </span>
          {item.href ? (
            <Link to={item.href} className="auth-link">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </p>
  );
}

export function CourseTabs({ tabs, activeTab, onTabChange }) {
  return (
    <nav className="course-tabs" aria-label="Secciones de la clase">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`course-tab${activeTab === tab.id ? " course-tab--active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
          {tab.count != null ? <span className="course-tab__count">{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}
