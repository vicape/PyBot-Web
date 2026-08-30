/** Roles en organization_members: owner | teacher | student */

export function isStaffRole(role) {
  return role === "owner" || role === "teacher";
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

/** Permiso real: owner o teacher en al menos un colegio (organization_members). */
export function hasStaffMembership(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => isStaffRole(o.organization_members?.[0]?.role));
}

/** @deprecated Alias de hasStaffMembership — usar nombre explícito en código nuevo. */
export function isTeacherInAnyOrg(orgs) {
  return hasStaffMembership(orgs);
}

/** Preferencia de onboarding; NO concede permisos institucionales. */
export function hasTeacherPreference(preferredRole) {
  return preferredRole === "teacher";
}

/**
 * Permiso docente real (solo membresía institucional).
 * El segundo argumento se ignora (compatibilidad); no usar preferred_role aquí.
 */
export function isTeacherProfile(orgs, _preferredRoleIgnored) {
  return hasStaffMembership(orgs);
}

/** Primera organización donde el usuario es owner/teacher; nunca una donde es student. */
export function resolveStaffOrgId(orgs) {
  if (!Array.isArray(orgs)) return null;
  const staff = orgs.find((o) => isStaffRole(o.organization_members?.[0]?.role));
  return staff?.id ?? null;
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
