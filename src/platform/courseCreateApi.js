import { getSupabase } from "../supabaseClient.js";
import { slugifyOrganizationName } from "../slugify.js";

/**
 * Create a personal course (no institution).
 * Authorization is course-scoped via course_members.teacher for the creator.
 * Independent of presentation preferences and organization membership.
 */
export async function createPersonalCourse({ title, slug } = {}) {
  const sb = getSupabase();
  if (!sb) return { courseId: null, error: "no_supabase" };

  const trimmed = String(title ?? "").trim();
  if (!trimmed) return { courseId: null, error: "empty_title" };

  const pSlug = slug ? slugifyOrganizationName(slug) : slugifyOrganizationName(trimmed);

  const { data, error } = await sb.rpc("create_personal_course", {
    p_title: trimmed,
    p_slug: pSlug || null,
  });

  if (error) {
    return { courseId: null, error: error.message };
  }
  if (!data?.ok || !data?.course_id) {
    return { courseId: null, error: data?.error || "create_failed" };
  }
  return {
    courseId: data.course_id,
    orgId: data.org_id ?? null,
    title: data.title ?? trimmed,
    slug: data.slug ?? pSlug,
    error: null,
  };
}

/**
 * Create an institutional course under an existing org (staff-authorized).
 */
export async function createInstitutionalCourse({ orgId, title, userId }) {
  const sb = getSupabase();
  if (!sb) return { courseId: null, error: "no_supabase" };
  if (!orgId || !userId) return { courseId: null, error: "missing_args" };

  const trimmed = String(title ?? "").trim();
  if (!trimmed) return { courseId: null, error: "empty_title" };

  const { data, error } = await sb
    .from("courses")
    .insert({
      org_id: orgId,
      title: trimmed,
      slug: slugifyOrganizationName(trimmed),
      created_by: userId,
    })
    .select("id")
    .maybeSingle();

  if (error) return { courseId: null, error: error.message };
  return { courseId: data?.id ?? null, orgId, error: null };
}
