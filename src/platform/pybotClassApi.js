import { getSupabase } from "../supabaseClient.js";

export const PYBOTCLASS_MIGRATION_HINT =
  "Faltan las migraciones PyBotClass en Supabase. Ejecutá en el SQL Editor: 20260831000031_pybotclass_security_fix.sql, 20260831000032_pybotclass_activity_meta.sql y 20260831000033_pybotclass_queries.sql";

function isMissingRpcError(message) {
  return /Could not find the function|schema cache|function.*does not exist/i.test(message ?? "");
}

function isStaffOrgRole(role) {
  return role === "owner" || role === "teacher";
}

async function fallbackListPybotclassOrganizations(sb) {
  const orgMap = new Map();

  const rpc = await sb.rpc("list_my_org_memberships");
  if (!rpc.error && Array.isArray(rpc.data)) {
    for (const m of rpc.data) {
      orgMap.set(m.org_id, {
        org_id: m.org_id,
        org_name: m.org_name || m.org_id,
        access_kind: "org_member",
      });
    }
  }

  const { data: session } = await sb.auth.getUser();
  const userId = session?.user?.id;
  if (userId) {
    const { data: cmRows } = await sb
      .from("course_members")
      .select("course_id, courses ( org_id, organizations ( name ) )")
      .eq("user_id", userId);
    for (const row of cmRows ?? []) {
      const orgId = row.courses?.org_id;
      if (!orgId || orgMap.has(orgId)) continue;
      orgMap.set(orgId, {
        org_id: orgId,
        org_name: row.courses?.organizations?.name || orgId,
        access_kind: "course_member",
      });
    }
  }

  return { rows: [...orgMap.values()].sort((a, b) => a.org_name.localeCompare(b.org_name)), error: null };
}

async function fallbackListPybotclassMyCourses(sb, orgId) {
  const { data: session } = await sb.auth.getUser();
  const userId = session?.user?.id;
  if (!userId) return { rows: [], error: "no_session" };

  const byCourse = new Map();

  const memberships = await sb.rpc("list_my_org_memberships");
  const staffOrgIds = (memberships.data ?? [])
    .filter((m) => isStaffOrgRole(m.role))
    .map((m) => m.org_id)
    .filter((id) => !orgId || id === orgId);

  if (staffOrgIds.length > 0) {
    let q = sb
      .from("courses")
      .select("id, title, org_id, classroom_course_id, organizations ( name )")
      .in("org_id", staffOrgIds);
    const { data: staffCourses, error: staffErr } = await q;
    if (staffErr) return { rows: [], error: staffErr.message };
    for (const c of staffCourses ?? []) {
      byCourse.set(c.id, {
        course_id: c.id,
        course_title: c.title,
        org_id: c.org_id,
        org_name: c.organizations?.name || "",
        classroom_course_id: c.classroom_course_id,
        my_course_role: "teacher",
        student_count: 0,
        activity_count: 0,
        submission_count: 0,
        pending_grade_count: 0,
      });
    }
  }

  let cmQuery = sb
    .from("course_members")
    .select("role, courses ( id, title, org_id, classroom_course_id, organizations ( name ) )")
    .eq("user_id", userId);
  const { data: cmRows, error: cmErr } = await cmQuery;
  if (cmErr) return { rows: [], error: cmErr.message };

  for (const row of cmRows ?? []) {
    const c = row.courses;
    if (!c?.id) continue;
    if (orgId && c.org_id !== orgId) continue;
    if (!byCourse.has(c.id)) {
      byCourse.set(c.id, {
        course_id: c.id,
        course_title: c.title,
        org_id: c.org_id,
        org_name: c.organizations?.name || "",
        classroom_course_id: c.classroom_course_id,
        my_course_role: row.role,
        student_count: 0,
        activity_count: 0,
        submission_count: 0,
        pending_grade_count: 0,
      });
    }
  }

  return {
    rows: [...byCourse.values()].sort((a, b) => a.course_title.localeCompare(b.course_title)),
    error: null,
  };
}

export async function listPybotclassOrganizations() {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "no_supabase" };
  const { data, error } = await sb.rpc("list_pybotclass_organizations");
  if (!error) return { rows: data ?? [], error: null };
  if (isMissingRpcError(error.message)) return fallbackListPybotclassOrganizations(sb);
  return { rows: [], error: error.message };
}

export async function listPybotclassMyCourses(orgId = null) {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "no_supabase" };
  const { data, error } = await sb.rpc("list_pybotclass_my_courses", {
    p_org_id: orgId || null,
  });
  if (!error) return { rows: data ?? [], error: null };
  if (isMissingRpcError(error.message)) return fallbackListPybotclassMyCourses(sb, orgId);
  return { rows: [], error: error.message };
}

export async function fetchPybotclassCourseSummary(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { summary: null, error: "missing_args" };
  const { data, error } = await sb.rpc("get_pybotclass_course_summary", {
    p_course_id: courseId,
  });
  if (error) return { summary: null, error: error.message };
  if (!data?.ok) return { summary: null, error: data?.error || "forbidden" };
  return { summary: data, error: null };
}

export async function fetchPybotclassStudentSummary(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { summary: null, error: "missing_args" };
  const { data, error } = await sb.rpc("get_pybotclass_student_summary", {
    p_course_id: courseId,
  });
  if (error) return { summary: null, error: error.message };
  if (!data?.ok) return { summary: null, error: data?.error || "forbidden" };
  return { summary: data, error: null };
}

export async function fetchCourseSubmissionOverview(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { rows: [], error: "missing_args" };
  const { data, error } = await sb.rpc("get_pybotclass_course_submission_overview", {
    p_course_id: courseId,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

export async function fetchPybotclassGradebook(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { gradebook: null, error: "missing_args" };
  const { data, error } = await sb.rpc("get_pybotclass_gradebook", {
    p_course_id: courseId,
  });
  if (error) return { gradebook: null, error: error.message };
  if (!data?.ok) return { gradebook: null, error: data?.error || "forbidden" };
  return { gradebook: data, error: null };
}

export async function fetchCourseBasics(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { course: null, error: "missing_args" };
  const { data, error } = await sb
    .from("courses")
    .select("id, title, org_id, classroom_course_id, organizations(name)")
    .eq("id", courseId)
    .maybeSingle();
  if (error) return { course: null, error: error.message };
  return { course: data, error: null };
}

export async function fetchCourseActivities(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { rows: [], error: "missing_args" };
  const { data, error } = await sb
    .from("activities")
    .select(
      "id, title, description, starter_code, pybot_lesson_id, content_lesson_id, content_snapshot, content_source_type, activity_kind, origin, due_at, max_points, classroom_coursework_id, classroom_coursework_url, classroom_last_synced_at, created_at",
    )
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) {
    const fb = await sb
      .from("activities")
      .select("id, title, description, starter_code, pybot_lesson_id, created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    return { rows: fb.data ?? [], error: fb.error?.message ?? null };
  }
  return { rows: data ?? [], error: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function createPybotclassActivity(supabase, fields) {
  if (!supabase || !fields.courseId || !fields.createdBy) {
    return { row: null, error: "missing_args" };
  }
  const title = String(fields.title ?? "").trim();
  if (!title) return { row: null, error: "Título requerido" };

  const payload = {
    course_id: fields.courseId,
    title,
    description: String(fields.description ?? "").trim(),
    pybot_lesson_id: String(fields.pybotLessonId ?? "").trim() || null,
    starter_code: String(fields.starterCode ?? ""),
    created_by: fields.createdBy,
    origin: "pybot",
    due_at: fields.dueAt || null,
    max_points: fields.maxPoints != null && fields.maxPoints !== "" ? Number(fields.maxPoints) : null,
  };
  if (fields.contentLessonId) {
    payload.content_lesson_id = fields.contentLessonId;
  }

  const { data, error } = await supabase
    .from("activities")
    .insert(payload)
    .select("id, title, due_at, max_points, content_lesson_id, created_at")
    .maybeSingle();

  if (error) return { row: null, error: error.message };
  return { row: data, error: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function updatePybotclassActivity(supabase, activityId, fields) {
  if (!supabase || !activityId) return { ok: false, error: "missing_args" };
  const title = String(fields.title ?? "").trim();
  if (!title) return { ok: false, error: "Título requerido" };

  const rpc = await supabase.rpc("update_activity_for_staff", {
    p_activity_id: activityId,
    p_title: title,
    p_description: String(fields.description ?? ""),
    p_pybot_lesson_id: String(fields.pybotLessonId ?? "").trim() || null,
    p_starter_code: String(fields.starterCode ?? ""),
  });

  if (rpc.error) return { ok: false, error: rpc.error.message };

  const meta = {
    due_at: fields.dueAt || null,
    max_points:
      fields.maxPoints != null && fields.maxPoints !== "" ? Number(fields.maxPoints) : null,
  };

  const { error } = await supabase.from("activities").update(meta).eq("id", activityId);
  if (error && !/due_at|max_points/i.test(error.message)) {
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/** Deriva etiqueta de estado para vista de entregas. */
export function deriveSubmissionOverviewStatus(row) {
  if (!row?.submission_id) return "no_entrego";
  if (row.submission_status === "submitted") return "por_corregir";
  if (row.submission_status === "graded" || row.submission_status === "returned") {
    return "corregida";
  }
  return "no_entrego";
}

export function submissionOverviewLabelEs(status) {
  switch (status) {
    case "no_entrego":
      return "No entregó";
    case "por_corregir":
      return "Por corregir";
    case "corregida":
      return "Corregida";
    default:
      return status || "—";
  }
}

export function formatDueDateEs(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return null;
  }
}

export function formatDateTimeEs(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Mapea courseWork de Classroom a campos de actividad PyBot. */
export function mapClassroomCourseWorkToActivity(courseWork) {
  let dueAt = null;
  if (courseWork?.dueDate) {
    const y = courseWork.dueDate.year;
    const m = String(courseWork.dueDate.month).padStart(2, "0");
    const d = String(courseWork.dueDate.day).padStart(2, "0");
    let time = "23:59:59";
    if (courseWork.dueTime) {
      const hh = String(courseWork.dueTime.hours ?? 23).padStart(2, "0");
      const mm = String(courseWork.dueTime.minutes ?? 59).padStart(2, "0");
      time = `${hh}:${mm}:00`;
    }
    dueAt = `${y}-${m}-${d}T${time}`;
  }
  return {
    title: courseWork?.title || "Actividad Classroom",
    description: courseWork?.description || "",
    origin: "classroom",
    classroom_coursework_id: courseWork?.id || null,
    classroom_coursework_url: courseWork?.alternateLink || null,
    max_points: courseWork?.maxPoints != null ? Number(courseWork.maxPoints) : null,
    due_at: dueAt,
    classroom_last_synced_at: new Date().toISOString(),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function importClassroomActivities(supabase, { courseId, courseWorks, createdBy }) {
  if (!supabase || !courseId || !createdBy) {
    return { imported: 0, updated: 0, error: "missing_args" };
  }
  let imported = 0;
  let updated = 0;

  for (const cw of courseWorks) {
    const mapped = mapClassroomCourseWorkToActivity(cw);
    if (!mapped.classroom_coursework_id) continue;

    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("course_id", courseId)
      .eq("classroom_coursework_id", mapped.classroom_coursework_id)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from("activities")
        .update({
          title: mapped.title,
          description: mapped.description,
          origin: "classroom",
          classroom_coursework_url: mapped.classroom_coursework_url,
          max_points: mapped.max_points,
          due_at: mapped.due_at,
          classroom_last_synced_at: mapped.classroom_last_synced_at,
        })
        .eq("id", existing.id);
      if (!error) updated += 1;
    } else {
      const { error } = await supabase.from("activities").insert({
        course_id: courseId,
        created_by: createdBy,
        starter_code: "",
        ...mapped,
      });
      if (!error) imported += 1;
    }
  }

  return { imported, updated, error: null };
}

export function countPendingClassroomGrades(gradebook) {
  if (!gradebook?.grades || !gradebook?.activities) return 0;
  const classroomActivityIds = new Set(
    (gradebook.activities || [])
      .filter((a) => a.classroom_coursework_id)
      .map((a) => a.id),
  );
  return (gradebook.grades || []).filter((g) => {
    if (!classroomActivityIds.has(g.activity_id)) return false;
    if (g.grade == null) return false;
    if (g.classroom_grade_synced_at) return false;
    return true;
  }).length;
}
