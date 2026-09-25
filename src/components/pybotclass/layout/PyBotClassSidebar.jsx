import { t } from "../../../i18n.js";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { PRIMARY_NAV_IDS } from "../../../platform/uxIaHelpers.js";
import { IconSuperAdmin, SidebarIcon } from "../illustrations/SidebarIcons.jsx";

const DAILY_NAV = [
  { id: "home", labelKey: "pcHome", to: "/dashboard/classes" },
  { id: "courses", labelKey: "pcCourses", to: "/dashboard/classes?view=courses" },
  { id: "content", labelKey: "pcNavContent", to: "/dashboard/content", teacherOnly: true },
  { id: "community", labelKey: "pcCommunity", to: "/dashboard/community" },
  { id: "ide", labelKey: "pcOpenIde", to: "/", external: true },
];

export default function PyBotClassSidebar({
  id = "pbc-sidebar",
  open,
  onClose,
  showAdmin,
  onNavigate,
  showMyContent = true,
  showInstitutions = true,
}) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const panel = params.get("panel");
  const tab = params.get("tab");
  const view = params.get("view");
  const path = location.pathname;

  const nav = useMemo(
    () =>
      DAILY_NAV.filter((item) => {
        if (item.id === "content") return showMyContent;
        return PRIMARY_NAV_IDS.includes(item.id);
      }),
    [showMyContent],
  );

  const isActive = (item) => {
    if (item.id === "home") {
      return (
        path === "/dashboard/classes" &&
        !panel &&
        view !== "courses" &&
        location.hash !== "#mis-cursos"
      );
    }
    if (item.id === "courses") {
      return (
        !panel &&
        (view === "courses" ||
          location.hash === "#mis-cursos" ||
          /^\/dashboard\/classes\/[^/]+/.test(path))
      );
    }
    if (item.id === "content") {
      return path.startsWith("/dashboard/content");
    }
    if (item.id === "community") {
      return path.startsWith("/dashboard/community");
    }
    if (item.id === "ide") return false;
    return false;
  };

  const adminActive = path === "/dashboard/admin" || path.startsWith("/dashboard/admin/");
  const institutionsActive =
    (path === "/dashboard" && tab === "schools") || path.startsWith("/dashboard/org/");
  const showAdminSection = showAdmin || showInstitutions;

  const renderLink = (item) => {
    const label = t(item.labelKey);
    const cls = `pbc-sidebar__link${isActive(item) ? " pbc-sidebar__link--active" : ""}`;
    if (item.external) {
      return (
        <a key={item.id} href={item.to} className={cls} onClick={onClose}>
          <span className="pbc-sidebar__icon" aria-hidden>
            <SidebarIcon id={item.id} />
          </span>
          {label}
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
          onNavigate?.(item);
        }}
      >
        <span className="pbc-sidebar__icon" aria-hidden>
          <SidebarIcon id={item.id} />
        </span>
        {label}
      </Link>
    );
  };

  return (
    <aside
      id={id}
      className={`pbc-sidebar${open ? " pbc-sidebar--open" : ""}`}
      aria-label={t("pcNavigation")}
    >
      <Link to="/dashboard/classes" className="pbc-sidebar__brand" onClick={onClose}>
        <span className="pbc-sidebar__logo" aria-hidden>
          {"</>"}
        </span>
        <span>
          <div className="pbc-sidebar__title">PyBotClass</div>
          <div className="pbc-sidebar__subtitle">{t("pcTechnologyEducation")}</div>
        </span>
      </Link>

      <nav className="pbc-sidebar__nav" aria-label={t("pcDailyNav")}>
        {nav.map(renderLink)}
      </nav>

      {showAdminSection ? (
        <>
          <div className="pbc-sidebar__section">{t("pcAdministration")}</div>
          {showInstitutions ? (
            <Link
              to="/dashboard?tab=schools"
              className={`pbc-sidebar__link${institutionsActive ? " pbc-sidebar__link--active" : ""}`}
              onClick={onClose}
            >
              <span className="pbc-sidebar__icon" aria-hidden>
                <SidebarIcon id="institutions" />
              </span>
              {t("pcInstitutions")}
            </Link>
          ) : null}
          {showAdmin ? (
            <Link
              to="/dashboard/admin"
              className={`pbc-sidebar__link pbc-sidebar__link--admin${adminActive ? " pbc-sidebar__link--active" : ""}`}
              onClick={onClose}
            >
              <span className="pbc-sidebar__icon" aria-hidden>
                <IconSuperAdmin />
              </span>
              {t("pcSuperAdminPanel")}
            </Link>
          ) : null}
        </>
      ) : null}

      <div className="pbc-sidebar__footer">PyBot Web</div>
    </aside>
  );
}
