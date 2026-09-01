/** Roles en organization_members: owner | teacher | student */

export function isStaffRole(role) {
  return role === "owner" || role === "teacher";
}

export function isStudentRole(role) {
  return role === "student";
}

export function roleLabelEs(role) {
  switch (role) {
    case "owner":
      return "Gestión";
    case "teacher":
      return "Docente";
    case "student":
      return "Alumno";
    default:
      return role || "—";
  }
}

function memberRole(org) {
  return org?.organization_members?.[0]?.role ?? null;
}

/** Permiso real: owner o teacher en al menos un colegio. */
export function hasStaffMembership(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => isStaffRole(memberRole(o)));
}

/** Membresía student explícita (no se infiere por ausencia de staff). */
export function hasStudentMembership(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => isStudentRole(memberRole(o)));
}

export function getStaffOrganizations(orgs) {
  if (!Array.isArray(orgs)) return [];
  return orgs.filter((o) => isStaffRole(memberRole(o)));
}

export function getStudentOrganizations(orgs) {
  if (!Array.isArray(orgs)) return [];
  return orgs.filter((o) => isStudentRole(memberRole(o)));
}

/** @deprecated Alias de hasStaffMembership */
export function isTeacherInAnyOrg(orgs) {
  return hasStaffMembership(orgs);
}

/** Preferencia de onboarding; NO concede permisos. */
export function hasTeacherPreference(preferredRole) {
  return preferredRole === "teacher";
}

/**
 * Permiso docente real (solo membresía).
 * El segundo argumento se ignora (compatibilidad).
 */
export function isTeacherProfile(orgs, _preferredRoleIgnored) {
  return hasStaffMembership(orgs);
}

/** Primera org donde el usuario es owner/teacher; nunca una donde solo es student. */
export function resolveStaffOrgId(orgs) {
  if (!Array.isArray(orgs)) return null;
  const staff = orgs.find((o) => isStaffRole(memberRole(o)));
  return staff?.id ?? null;
}

/**
 * Capacidades de navegación independientes (multirol).
 * @param {{ orgs?: unknown[], enrolledCourseCount?: number }} opts
 */
export function getDashboardNavCapabilities({ orgs = [], enrolledCourseCount = 0 } = {}) {
  const hasStaffAccess = hasStaffMembership(orgs);
  const hasStudentAccess = hasStudentMembership(orgs) || enrolledCourseCount > 0;
  return {
    hasStaffAccess,
    hasStudentAccess,
    showSchoolsTab: hasStaffAccess,
    showCoursesTab: hasStudentAccess,
    showClassroomTab: hasStaffAccess,
    showPyBotClassTab: hasStaffAccess || hasStudentAccess,
  };
}

export async function fetchMyOrgRole(supabase, orgId, userId) {
  if (!supabase || !orgId || !userId) return null;

  const rpc = await supabase.rpc("my_role_in_org", { p_org_id: orgId });
  if (!rpc.error) return rpc.data ?? null;

  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("fetchMyOrgRole:", error);
    return null;
  }
  return data?.role ?? null;
}
