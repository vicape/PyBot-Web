import { t } from "../../../i18n.js";
import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../../../platform/useAppearance.js";
import "../../../styles/dashboard-theme.css";
import "../../../styles/pybotclass-dashboard.css";
import { AppearanceContext } from "./appearanceContext.js";
import PyBotClassSidebar from "./PyBotClassSidebar.jsx";
import PyBotClassTopbar from "./PyBotClassTopbar.jsx";
import { useHasStaffAccess } from "./useHasStaffAccess.js";

/* Desktop viewport: >= 961px — sidebar defaults open and hamburger is a real toggle. */
const DESKTOP_MQ = "(min-width: 961px)"; // >= 961px
const PBC_SIDEBAR_ID = "pbc-sidebar";

function isDesktopViewport() {
  // True when viewport is >= 961px (desktop).
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

/**
 * Shell único de PyBotClass (todo lo que no es el IDE).
 */
export default function PyBotClassLayout({
  user,
  showAdmin = false,
  hideSearch = false,
  search = "",
  onSearchChange,
  onSignOut,
  hasStaffAccess: hasStaffAccessProp,
  contextualRoleLabel = null,
  contextualRoleCompact = null,
  children,
}) {
  const containerRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => isDesktopViewport());
  const { appearance, updateAppearance } = useAppearance(user?.id, containerRef);
  const hasStaffAccess = useHasStaffAccess(user, hasStaffAccessProp);
  // Fail closed while resolving: hide teacher tools until known
  const showTeacherTools = hasStaffAccess === true;

  const meta = user?.user_metadata || {};
  const name =
    meta.full_name || meta.name || meta.display_name || user?.email?.split("@")[0] || t("pcUser");
  const picture = meta.avatar_url || meta.picture || null;

  // Desktop defaults open; mobile/tablet defaults closed. Reset on breakpoint change
  // so resize never leaves overlay/sidebar in an impossible state.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const syncToViewport = () => setSidebarOpen(mq.matches);
    mq.addEventListener("change", syncToViewport);
    return () => mq.removeEventListener("change", syncToViewport);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const closeDrawer = () => {
    // Nav/overlay close applies to the mobile drawer; desktop stays toggled by hamburger.
    if (!isDesktopViewport()) setSidebarOpen(false);
  };

  return (
    <AppearanceContext.Provider value={{ appearance, updateAppearance }}>
      <div className="pbc-dashboard" ref={containerRef} data-pybot-theme="pbc">
        <button
          type="button"
          className={`pbc-dashboard__overlay${sidebarOpen ? " pbc-dashboard__overlay--open" : ""}`}
          aria-label={t("pcCloseMenu")}
          onClick={closeDrawer}
        />

        <PyBotClassSidebar
          id={PBC_SIDEBAR_ID}
          open={sidebarOpen}
          onClose={closeDrawer}
          showAdmin={showAdmin}
          showMyContent={showTeacherTools}
          showInstitutions={showTeacherTools}
        />

        <div className="pbc-dashboard__main">
          <PyBotClassTopbar
            userName={name}
            userEmail={user?.email}
            userPicture={picture}
            search={search}
            onSearchChange={onSearchChange}
            hideSearch={hideSearch}
            appearance={appearance}
            onThemeChange={updateAppearance}
            onSignOut={onSignOut}
            sidebarOpen={sidebarOpen}
            sidebarId={PBC_SIDEBAR_ID}
            onMenuToggle={() => setSidebarOpen((open) => !open)}
            contextualRoleLabel={contextualRoleLabel}
            contextualRoleCompact={contextualRoleCompact}
            accountHref="/dashboard/classes?panel=account"
          />
          <div className="pbc-dashboard__content">{children}</div>
        </div>
      </div>
    </AppearanceContext.Provider>
  );
}

export { useAppearanceContext } from "./appearanceContext.js";
