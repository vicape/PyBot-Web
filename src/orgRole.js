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

function memberRoles(org) {
  if (Array.isArray(org?.organization_members) && org.organization_members.length) {
    return org.organization_members.map((m) => m?.role).filter(Boolean);
  }
  if (Array.isArray(org?.roles) && org.roles.length) return org.roles.filter(Boolean);
  if (org?.role) return [org.role];
  return [];
}

function memberRole(org) {
  const roles = memberRoles(org);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("teacher")) return "teacher";
  if (roles.includes("student")) return "student";
  return roles[0] ?? null;
}

/** Permiso real: owner o teacher en al menos un colegio. */
export function hasStaffMembership(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => memberRoles(o).some(isStaffRole));
}

/** Membresía student explícita (no se infiere por ausencia de staff). */
export function hasStudentMembership(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => memberRoles(o).some(isStudentRole));
}

export function getStaffOrganizations(orgs) {
  if (!Array.isArray(orgs)) return [];
  return orgs.filter((o) => memberRoles(o).some(isStaffRole));
}

export function getStudentOrganizations(orgs) {
  if (!Array.isArray(orgs)) return [];
  return orgs.filter((o) => memberRoles(o).some(isStudentRole));
}

/** True when the person holds more than one existing role in the same institution. */
export function hasMultipleRolesInOrg(org) {
  return new Set(memberRoles(org)).size > 1;
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
 * Presentation: el usuario pidió experiencia orientada a docente.
 * Equivale a preferred_role === 'teacher'. NUNCA es autorización.
 */
export function wantsTeacherExperience(preferredRole) {
  return preferredRole === "teacher";
}

/**
 * Authorization: capacidades docentes privilegiadas.
 * Solo hasStaffAccess factual — NUNCA incluye preferredRole.
 */
export function canUseTeacherCapabilities(hasStaffAccess) {
  return hasStaffAccess === true;
}

/**
 * Instituciones es contexto opcional de organización/admin para toda persona autenticada.
 * preferred_role / staff solo orientan presentación — NO conceden Create Course ni otras capacidades.
 * @param {{ hasStaffAccess?: boolean, preferredRole?: string | null, hasOrgMembership?: boolean }} [_opts]
 */
export function canShowInstitutionsEntry(_opts = {}) {
  void _opts;
  return true;
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
  const hasOrgMembership = Array.isArray(orgs) && orgs.length > 0;
  const hasStudentAccess = hasStudentMembership(orgs) || enrolledCourseCount > 0;
  return {
    hasStaffAccess,
    hasStudentAccess,
    hasOrgMembership,
    // Institutions = optional membership/admin context (not staff-only)
    showSchoolsTab: true,
    showCoursesTab: true,
    showClassroomTab: hasStaffAccess,
    showPyBotClassTab: true,
  };
}

/**
 * Rol del caller en un colegio.
 * Usa SELECT directo a organization_members (RLS om_select_self: solo filas propias).
 * Equivalente fail-closed a RPC my_role_in_org; no depende de que la RPC esté
 * publicada en PostgREST (evita HTTP 404 de /rest/v1/rpc/my_role_in_org).
 */
export async function fetchMyOrgRole(supabase, orgId, userId) {
  if (!supabase || !orgId || !userId) return null;

  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) {
    console.error("fetchMyOrgRole:", error);
    return null;
  }
  const roles = (data ?? []).map((r) => r.role).filter(Boolean);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("teacher")) return "teacher";
  if (roles.includes("student")) return "student";
  return roles[0] ?? null;
}
