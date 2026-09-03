import { Link, useLocation } from "react-router-dom";

const NAV = [
  { id: "home", label: "Inicio", to: "/dashboard/classes", icon: "⌂" },
  { id: "courses", label: "Mis cursos", to: "/dashboard/classes#mis-cursos", icon: "▤" },
  { id: "ide", label: "Abrir IDE", to: "/", icon: "</>", external: true },
  { id: "classroom", label: "Google Classroom", to: "/dashboard/classes?panel=classroom", icon: "G" },
  { id: "institutions", label: "Instituciones", to: "/dashboard?tab=schools", icon: "🏛" },
  { id: "account", label: "Cuenta", to: "/dashboard/classes?panel=account", icon: "◎" },
];

export default function PyBotClassSidebar({ open, onClose, showAdmin, onNavigate }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const panel = params.get("panel");
  const tab = params.get("tab");
  const path = location.pathname;

  const isActive = (item) => {
    if (item.id === "classroom") return panel === "classroom" || tab === "classroom";
    if (item.id === "account") return panel === "account" || tab === "account";
    if (item.id === "institutions") {
      return (
        (path === "/dashboard" && tab === "schools") ||
        path.startsWith("/dashboard/org/")
      );
    }
    if (item.id === "home") {
      return path === "/dashboard/classes" && !panel && location.hash !== "#mis-cursos";
    }
    if (item.id === "courses") {
      return (
        !panel &&
        (location.hash === "#mis-cursos" || /^\/dashboard\/classes\/[^/]+/.test(path))
      );
    }
    if (item.id === "ide") return false;
    return false;
  };

  const adminActive = path === "/dashboard/admin" || path.startsWith("/dashboard/admin/");

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
      <Link
        key={item.id}
        to={item.to}
        className={cls}
        onClick={() => {
          onClose?.();
          const content = document.querySelector(".pbc-dashboard__content");
          if (item.id === "home") {
            content?.scrollTo({ top: 0, behavior: "smooth" });
          }
          if (item.id === "courses" && path === "/dashboard/classes" && location.hash === "#mis-cursos") {
            document.getElementById("mis-cursos")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          onNavigate?.(item);
        }}
      >
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
            className={`pbc-sidebar__link pbc-sidebar__link--admin${adminActive ? " pbc-sidebar__link--active" : ""}`}
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
