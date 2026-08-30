import { useNavigate } from "react-router-dom";
import DashboardShell from "./DashboardShell.jsx";
import { isStaffRole } from "../../orgRole.js";

/**
 * Mantiene el header + tabs del panel en subpáginas (colegio / curso).
 * Las pestañas vuelven a /dashboard?tab=…
 */
export default function DashboardSubpageShell({
  user,
  myRole = null,
  showClassroomTab,
  studentView = false,
  onSignOut,
  children,
}) {
  const navigate = useNavigate();
  const meta = user?.user_metadata || {};
  const name =
    meta.full_name || meta.name || meta.display_name || user?.email?.split("@")[0] || "Usuario";
  const picture = meta.avatar_url || meta.picture || null;
  const classroom =
    typeof showClassroomTab === "boolean" ? showClassroomTab : isStaffRole(myRole);
  const isStudent = studentView || (myRole === "student" && !isStaffRole(myRole));

  const goTab = (tabId) => {
    if (tabId === "home") navigate("/dashboard");
    else navigate(`/dashboard?tab=${encodeURIComponent(tabId)}`);
  };

  return (
    <DashboardShell
      activeTab={isStudent ? "courses" : "schools"}
      onTabChange={goTab}
      showClassroomTab={classroom}
      studentView={isStudent}
      userName={name}
      userEmail={user?.email}
      userPicture={picture}
      onSignOut={onSignOut}
    >
      <section className="dash-panel">{children}</section>
    </DashboardShell>
  );
}
