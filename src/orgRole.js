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
