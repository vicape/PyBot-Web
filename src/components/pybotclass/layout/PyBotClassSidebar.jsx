import { Link, useLocation } from "react-router-dom";

const NAV = [
  { id: "home", label: "Inicio", to: "/dashboard/classes", icon: "⌂" },
  { id: "courses", label: "Mis cursos", to: "/dashboard/classes", icon: "▤" },
  { id: "ide", label: "Abrir IDE", to: "/", icon: "</>", external: true },
  { id: "classroom", label: "Google Classroom", to: "/dashboard/classes?panel=classroom", icon: "G" },
  { id: "institutions", label: "Instituciones", to: "/dashboard?tab=schools", icon: "🏛" },
  { id: "account", label: "Cuenta", to: "/dashboard/classes?panel=account", icon: "◎" },
];

export default function PyBotClassSidebar({ open, onClose, showAdmin, onNavigate }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const panel = params.get("panel");

  const isActive = (item) => {
    if (item.id === "classroom") return panel === "classroom";
    if (item.id === "account") return panel === "account";
    if (item.id === "institutions") return location.pathname === "/dashboard" && params.get("tab") === "schools";
    if (item.id === "courses" || item.id === "home") {
      return location.pathname === "/dashboard/classes" && !panel && !location.pathname.includes("/classes/");
    }
    if (item.id === "ide") return false;
    return false;
  };

  const renderLink = (item) => {
    const cls = `pbc-sidebar__link${isActive(item) ? " pbc-sidebar__link--active" : ""}`;
    if (item.external) {
      return (
        <a key={item.id} href={item.to} className={cls} onClick={onClose}>
          <span className="pbc-sidebar__icon" aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </a>
      );
    }
    return (
      <Link key={item.id} to={item.to} className={cls} onClick={() => { onClose?.(); onNavigate?.(item); }}>
        <span className="pbc-sidebar__icon" aria-hidden>
          {item.icon}
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <aside className={`pbc-sidebar${open ? " pbc-sidebar--open" : ""}`} aria-label="Navegación PyBotClass">
      <Link to="/dashboard/classes" className="pbc-sidebar__brand" onClick={onClose}>
        <span className="pbc-sidebar__logo" aria-hidden>
          {"</>"}
        </span>
        <span>
          <div className="pbc-sidebar__title">PyBotClass</div>
          <div className="pbc-sidebar__subtitle">Tecnología · Educación</div>
        </span>
      </Link>

      <nav className="pbc-sidebar__nav">{NAV.map(renderLink)}</nav>

      {showAdmin ? (
        <>
          <div className="pbc-sidebar__section">Administración</div>
          <Link
            to="/dashboard/admin"
            className="pbc-sidebar__link pbc-sidebar__link--admin"
            onClick={onClose}
          >
            <span className="pbc-sidebar__icon" aria-hidden>
              ★
            </span>
            Panel SuperAdmin
          </Link>
        </>
      ) : null}

      <div className="pbc-sidebar__footer">PyBot Web</div>
    </aside>
  );
}
