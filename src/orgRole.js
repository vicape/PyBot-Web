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

  // Preferir RPC security definer (evita problemas de RLS)
  const rpc = await supabase.rpc("my_role_in_org", { p_org_id: orgId });
  if (!rpc.error) return rpc.data ?? null;

  // Fallback: query directo (filtrando por user_id propio para evitar recursión)
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
