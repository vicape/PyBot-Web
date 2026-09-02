import { useRef, useState } from "react";
import { useAppearance } from "../../../platform/useAppearance.js";
import "../../../styles/dashboard-theme.css";
import "../../../styles/pybotclass-dashboard.css";
import { AppearanceContext } from "./appearanceContext.js";
import PyBotClassSidebar from "./PyBotClassSidebar.jsx";
import PyBotClassTopbar from "./PyBotClassTopbar.jsx";

export default function PyBotClassLayout({
  user,
  showAdmin = false,
  search = "",
  onSearchChange,
  onSignOut,
  children,
}) {
  const containerRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { appearance, updateAppearance } = useAppearance(user?.id, containerRef);

  const meta = user?.user_metadata || {};
  const name =
    meta.full_name || meta.name || meta.display_name || user?.email?.split("@")[0] || "Usuario";
  const picture = meta.avatar_url || meta.picture || null;

  return (
    <AppearanceContext.Provider value={{ appearance, updateAppearance }}>
      <div className="pbc-dashboard" ref={containerRef} data-pybot-theme="pbc">
      <button
        type="button"
        className={`pbc-dashboard__overlay${sidebarOpen ? " pbc-dashboard__overlay--open" : ""}`}
        aria-label="Cerrar menú"
        onClick={() => setSidebarOpen(false)}
      />

      <PyBotClassSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        showAdmin={showAdmin}
      />

      <div className="pbc-dashboard__main">
        <PyBotClassTopbar
          userName={name}
          userEmail={user?.email}
          userPicture={picture}
          search={search}
          onSearchChange={onSearchChange}
          appearance={appearance}
          onThemeChange={updateAppearance}
          onSignOut={onSignOut}
          onMenuOpen={() => setSidebarOpen(true)}
        />
        <div className="pbc-dashboard__content">{children}</div>
      </div>
    </div>
    </AppearanceContext.Provider>
  );
}

export { useAppearanceContext } from "./appearanceContext.js";
