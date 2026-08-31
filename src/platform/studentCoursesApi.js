/** Cursos en los que el alumno está inscripto (course_members). */

export function mapEnrolledCourseRows(rows) {
  const byId = new Map();
  for (const row of rows ?? []) {
    const c = row.courses;
    if (!c?.id) continue;
    if (byId.has(c.id)) continue;
    byId.set(c.id, {
      id: c.id,
      title: c.title,
      slug: c.slug,
      created_at: c.created_at,
      org_id: c.org_id,
      orgName: c.organizations?.name ?? null,
      orgSlug: c.organizations?.slug ?? null,
    });
  }
  return [...byId.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {{ orgId?: string }} [opts]
 */
export async function fetchMyEnrolledCourses(supabase, userId, opts = {}) {
  if (!supabase || !userId) return { courses: [], error: null };

  const { data, error } = await supabase
    .from("course_members")
    .select(
      `
      course_id,
      role,
      courses (
        id,
        title,
        slug,
        created_at,
        org_id,
        organizations ( id, name, slug )
      )
    `,
    )
    .eq("user_id", userId)
    .eq("role", "student");

  if (error) return { courses: [], error };

  let courses = mapEnrolledCourseRows(data);
  if (opts.orgId) {
    courses = courses.filter((c) => c.org_id === opts.orgId);
  }
  return { courses, error: null };
}
