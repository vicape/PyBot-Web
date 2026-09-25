import { getSupabase } from "../supabaseClient.js";
import { listTeacherCoursesForAssign } from "./contentAssignApi.js";
import {
  communityMetadataGaps,
  LEARNING_CONTENT_SELECT_BASE,
  pickContentMetadata,
} from "./contentMetadata.js";

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

export const COMMUNITY_METADATA_REQUIRED_HINT =
  "Para publicar en Comunidad completá: título, idioma, rango de edad, tiempo estimado y dificultad.";

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
 * COMMUNITY exige metadata pedagógica mínima (S7).
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

  if (vis === "community") {
    const { data: current, error: curErr } = await sb
      .from("learning_contents")
      .select(LEARNING_CONTENT_SELECT_BASE)
      .eq("id", contentId)
      .maybeSingle();
    if (curErr) {
      if (/original_creator|first_community/i.test(curErr.message)) {
        return {
          content: null,
          error: "Falta aplicar la migración 20260925100049_learning_content_creator_community_provenance.sql",
        };
      }
      if (/language_code|recommended_age|difficulty|estimated_minutes/i.test(curErr.message)) {
        return {
          content: null,
          error: "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql",
        };
      }
      return { content: null, error: curErr.message };
    }
    const gaps = communityMetadataGaps(current);
    if (gaps.length > 0) {
      return {
        content: null,
        error: COMMUNITY_METADATA_REQUIRED_HINT,
        gaps,
      };
    }
  }

  const { data: content, error } = await sb
    .from("learning_contents")
    .update({ visibility: vis, updated_at: new Date().toISOString() })
    .eq("id", contentId)
    .select(LEARNING_CONTENT_SELECT_BASE)
    .maybeSingle();

  if (error) {
    if (/visibility/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260903000039_content_sharing.sql",
      };
    }
    if (/language_code|recommended_age|difficulty|estimated_minutes/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260924100048_material_v2_ownership_copy_metadata.sql",
      };
    }
    if (/original_creator|first_community/i.test(error.message)) {
      return {
        content: null,
        error: "Falta aplicar la migración 20260925100049_learning_content_creator_community_provenance.sql",
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

  return {
    content: content
      ? {
          ...content,
          ...pickContentMetadata(content),
          visibility: content.visibility || "private",
        }
      : null,
    error: null,
  };
}

export async function listTeacherCoursesForShare() {
  return listTeacherCoursesForAssign();
}

/**
 * Distinct-user usage semantics (pure; for tests + UI fallback mapping).
 * Overall = UNION of copy owners and assignment creators; owner excluded.
 * Must never equal copy_count + assignment_count when the same user appears in both.
 *
 * Copy source: learning_contents.owner_id where copied_from_content_id = content.id
 * Assignment source: activities.created_by where content_source_type='content'
 *   and content_source_id = content.id
 */
export function summarizeContentUsageCounts({
  copyOwnerIds = [],
  assignmentCreatorIds = [],
  ownerId = null,
} = {}) {
  const copySet = new Set(
    (copyOwnerIds || []).filter((id) => id && id !== ownerId).map(String),
  );
  const assignSet = new Set(
    (assignmentCreatorIds || []).filter((id) => id && id !== ownerId).map(String),
  );
  const totalSet = new Set([...copySet, ...assignSet]);
  return {
    distinct_copy_user_count: copySet.size,
    distinct_assignment_user_count: assignSet.size,
    distinct_total_user_count: totalSet.size,
  };
}

/**
 * Batched usage counts for the caller's owned contents via SECURITY DEFINER RPC.
 * On missing/undeployed RPC: unavailable=true (must NOT be treated as zero usage).
 */
export async function getMyContentUsageMetrics() {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "no_supabase", unavailable: true };

  const { data, error } = await sb.rpc("get_my_content_usage_metrics");
  if (error) {
    return { rows: [], error: error.message, unavailable: true };
  }

  return {
    rows: (data ?? []).map((r) => ({
      content_id: r.content_id,
      distinct_copy_user_count: Number(r.distinct_copy_user_count) || 0,
      distinct_assignment_user_count: Number(r.distinct_assignment_user_count) || 0,
      distinct_total_user_count: Number(r.distinct_total_user_count) || 0,
    })),
    error: null,
    unavailable: false,
  };
}

/**
 * Explore Community: visibility = 'community' AND owner_id != current user id.
 * Search only other users’ Community content (active-view scoped).
 */
export async function listCommunityContents({ search = "", excludeOwnerId } = {}) {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "no_supabase" };

  let excludeId = excludeOwnerId;
  if (excludeId == null) {
    const { data: session } = await sb.auth.getUser();
    excludeId = session?.user?.id || null;
  }

  let q = sb
    .from("learning_contents")
    .select(LEARNING_CONTENT_SELECT_BASE)
    .eq("visibility", "community")
    .order("updated_at", { ascending: false });

  if (excludeId) q = q.neq("owner_id", excludeId);

  const term = String(search || "").trim();
  if (term) q = q.ilike("title", `%${term}%`);

  const { data, error } = await q;
  if (error) {
    if (/language_code|recommended_age|difficulty|estimated_minutes|copied_from|original_creator|first_community/i.test(error.message)) {
      let legacyQ = sb
        .from("learning_contents")
        .select("id, title, description, visibility, owner_id, updated_at, created_at")
        .eq("visibility", "community")
        .order("updated_at", { ascending: false });
      if (excludeId) legacyQ = legacyQ.neq("owner_id", excludeId);
      if (term) legacyQ = legacyQ.ilike("title", `%${term}%`);
      const legacy = await legacyQ;
      if (legacy.error) return { rows: [], error: legacy.error.message };
      const ownerIds = [...new Set((legacy.data ?? []).map((r) => r.owner_id).filter(Boolean))];
      const profiles = await loadOwnerNames(sb, ownerIds);
      return {
        rows: (legacy.data ?? []).map((r) => ({
          ...r,
          ...pickContentMetadata({}),
          owner_name: profiles[r.owner_id] || "Docente",
        })),
        error: null,
      };
    }
    return { rows: [], error: error.message };
  }

  const profileIds = (data ?? []).flatMap((r) => [
    r.owner_id,
    r.original_owner_id,
    r.original_creator_id,
    r.first_community_published_by_id,
  ]);
  const profiles = await loadOwnerNames(sb, profileIds);

  return {
    rows: (data ?? []).map((r) => ({
      ...r,
      ...pickContentMetadata(r),
      owner_name: profiles[r.owner_id] || "Docente",
      original_owner_name: r.original_owner_id ? profiles[r.original_owner_id] || null : null,
      original_creator_name: r.original_creator_id ? profiles[r.original_creator_id] || null : null,
      first_community_published_by_name: r.first_community_published_by_id
        ? profiles[r.first_community_published_by_id] || null
        : null,
    })),
    error: null,
  };
}

async function loadOwnerNames(sb, ownerIds) {
  const profiles = {};
  if (!ownerIds.length) return profiles;
  const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", ownerIds);
  for (const p of profs ?? []) {
    profiles[p.id] = p.display_name || p.email || "Docente";
  }
  return profiles;
}
