import PyBotClassLayout from "./layout/PyBotClassLayout.jsx";

export default function PyBotClassShell({
  user,
  showAdminTab = false,
  adminActive = false,
  onSignOut,
  contextualRoleLabel = null,
  contextualRoleCompact = null,
  children,
}) {
  return (
    <PyBotClassLayout
      user={user}
      showAdmin={showAdminTab || adminActive}
      onSignOut={onSignOut}
      contextualRoleLabel={contextualRoleLabel}
      contextualRoleCompact={contextualRoleCompact}
    >
      <div className="pbc-course-page">{children}</div>
    </PyBotClassLayout>
  );
}

export { PbcBreadcrumb as PyBotClassBreadcrumb, PbcTabs as CourseTabs } from "./PyBotClassUi.jsx";
