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

/** True si el usuario es owner o teacher en al menos un colegio. */
export function isTeacherInAnyOrg(orgs) {
  if (!Array.isArray(orgs)) return false;
  return orgs.some((o) => {
    const role = o.organization_members?.[0]?.role;
    return role === "owner" || role === "teacher";
  });
}

/** Docente por membresía en colegio o por preferred_role antes de unirse. */
export function isTeacherProfile(orgs, preferredRole) {
  if (isTeacherInAnyOrg(orgs)) return true;
  return preferredRole === "teacher";
}

export async function fetchMyOrgRole(supabase, orgId, userId) {
  if (!supabase || !orgId || !userId) return null;
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role ?? null;
}
