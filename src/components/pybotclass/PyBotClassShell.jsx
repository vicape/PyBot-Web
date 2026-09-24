import PyBotClassLayout from "./layout/PyBotClassLayout.jsx";

export default function PyBotClassShell({
  user,
  showAdminTab = false,
  adminActive = false,
  onSignOut,
  contextualRoleLabel = null,
  children,
}) {
  return (
    <PyBotClassLayout
      user={user}
      showAdmin={showAdminTab || adminActive}
      onSignOut={onSignOut}
      contextualRoleLabel={contextualRoleLabel}
    >
      <div className="pbc-course-page">{children}</div>
    </PyBotClassLayout>
  );
}

export { PbcBreadcrumb as PyBotClassBreadcrumb, PbcTabs as CourseTabs } from "./PyBotClassUi.jsx";
