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
      <div className="pbc-shell">{children}</div>
    </DashboardShell>
  );
}

export { PbcBreadcrumb as PyBotClassBreadcrumb, PbcTabs as CourseTabs } from "./PyBotClassUi.jsx";
