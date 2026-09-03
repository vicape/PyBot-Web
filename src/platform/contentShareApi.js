import { getSupabase } from "../supabaseClient.js";
import { listTeacherCoursesForAssign } from "./contentAssignApi.js";

export const CONTENT_VISIBILITY = {
  private: "private",
  courses: "courses",
  community: "community",
};

export const CONTENT_VISIBILITY_LABELS = {
  private: "Privado",
  courses: "Mis cursos",
  community: "Comunidad PyBot",
};

export async function listContentCourseAccess(contentId) {
  const sb = getSupabase();
  if (!sb || !contentId) return { rows: [], error: "missing_args" };
  const { data, error } = await sb
    .from("content_course_access")
    .select("content_id, course_id, created_at")
    .eq("content_id", contentId);
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

/**
 * Actualiza visibility y set de cursos (solo cuando visibility=courses).
 */
export async function setContentSharing({ contentId, visibility, courseIds = [] }) {
  const sb = getSupabase();
  if (!sb || !contentId) return { content: null, error: "missing_args" };

  const vis = String(visibility || "private");
  if (!["private", "courses", "community"].includes(vis)) {
    return { content: null, error: "visibility_invalida" };
  }

  const ids = vis === "courses" ? [...new Set((courseIds || []).map(String).filter(Boolean))] : [];
  if (vis === "courses" && ids.length === 0) {
    return { content: null, error: "Elegí al menos un curso." };
  }

  const { data: content, error } = await sb
    .from("learning_contents")
    .update({ visibility: vis, updated_at: new Date().toISOString() })
    .eq("id", contentId)
    .select("id, title, description, status, visibility, owner_id, created_at, updated_at")
    .maybeSingle();

  if (error) {
    if (/visibility/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260903000039_content_sharing.sql",
      };
    }
    return { content: null, error: error.message };
  }

  const { error: delErr } = await sb.from("content_course_access").delete().eq("content_id", contentId);
  if (delErr) return { content: null, error: delErr.message };

  if (ids.length > 0) {
    const { error: insErr } = await sb.from("content_course_access").insert(
      ids.map((course_id) => ({ content_id: contentId, course_id })),
    );
    if (insErr) return { content: null, error: insErr.message };
  }

  return { content, error: null };
}

export async function listTeacherCoursesForShare() {
  return listTeacherCoursesForAssign();
}

export async function listCommunityContents({ search = "" } = {}) {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "no_supabase" };

  let q = sb
    .from("learning_contents")
    .select("id, title, description, visibility, owner_id, updated_at, created_at")
    .eq("visibility", "community")
    .order("updated_at", { ascending: false });

  const term = String(search || "").trim();
  if (term) q = q.ilike("title", `%${term}%`);

  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };

  const ownerIds = [...new Set((data ?? []).map((r) => r.owner_id).filter(Boolean))];
  let profiles = {};
  if (ownerIds.length) {
    const { data: profs } = await sb
      .from("profiles")
      .select("id, display_name, email")
      .in("id", ownerIds);
    for (const p of profs ?? []) {
      profiles[p.id] = p.display_name || p.email || "Docente";
    }
  }

  return {
    rows: (data ?? []).map((r) => ({
      ...r,
      owner_name: profiles[r.owner_id] || "Docente",
    })),
    error: null,
  };
}
