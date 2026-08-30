import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "./DashboardShell.jsx";
import {
  getDashboardNavCapabilities,
  hasStaffMembership,
  isStaffRole,
} from "../../orgRole.js";
import { getSupabase, isSupabaseConfigured } from "../../supabaseClient.js";

/**
 * Header + tabs del panel en subpáginas (colegio / curso).
 * Tabs globales según membresías; acciones locales las decide cada página con myRole.
 */
export default function DashboardSubpageShell({
  user,
  myRole = null,
  showClassroomTab,
  onSignOut,
  children,
}) {
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [orgRoles, setOrgRoles] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase || !user?.id) return;
    let cancelled = false;
    (async () => {
      const rpc = await supabase.rpc("list_my_org_memberships");
      if (cancelled) return;
      if (rpc.error || !Array.isArray(rpc.data)) {
        setOrgRoles([]);
        return;
      }
      setOrgRoles(
        rpc.data.map((m) => ({
          id: m.org_id,
          organization_members: [{ role: m.role }],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user?.id]);

  const meta = user?.user_metadata || {};
  const name =
    meta.full_name || meta.name || meta.display_name || user?.email?.split("@")[0] || "Usuario";
  const picture = meta.avatar_url || meta.picture || null;

  const caps = getDashboardNavCapabilities({ orgs: orgRoles, enrolledCourseCount: 0 });
  // Si aún no cargaron membresías, usar rol local como pista mínima
  const localStaff = isStaffRole(myRole);
  const showSchoolsTab = caps.showSchoolsTab || localStaff;
  const showCoursesTab = caps.showCoursesTab || myRole === "student";
  const classroom =
    typeof showClassroomTab === "boolean"
      ? showClassroomTab
      : caps.showClassroomTab || hasStaffMembership(orgRoles) || localStaff;

  const activeTab = localStaff ? "schools" : showCoursesTab ? "courses" : "home";

  const goTab = (tabId) => {
    if (tabId === "home") navigate("/dashboard");
    else navigate(`/dashboard?tab=${encodeURIComponent(tabId)}`);
  };

  return (
    <DashboardShell
      activeTab={activeTab}
      onTabChange={goTab}
      showSchoolsTab={showSchoolsTab}
      showCoursesTab={showCoursesTab}
      showClassroomTab={classroom}
      userName={name}
      userEmail={user?.email}
      userPicture={picture}
      onSignOut={onSignOut}
    >
      <section className="dash-panel">{children}</section>
    </DashboardShell>
  );
}
