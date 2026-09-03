import { getSupabase } from "../supabaseClient.js";
import { getContent, getLesson, updateContent } from "./contentApi.js";
import { listPybotclassMyCourses } from "./pybotClassApi.js";

function canAssignAsTeacher(row) {
  const role = row?.my_course_role;
  // list_pybotclass_my_courses usa el rol de org (owner|teacher) o de course_members.
  return role === "teacher" || role === "owner";
}

/**
 * Cursos donde el usuario es docente (para asignar lecciones).
 */
export async function listTeacherCoursesForAssign() {
  const { rows, error } = await listPybotclassMyCourses(null);
  if (error) return { rows: [], error };
  return {
    rows: (rows ?? []).filter(canAssignAsTeacher),
    error: null,
  };
}

/**
 * Alumnos del roster del curso (role=student).
 */
export async function listCourseStudents(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { rows: [], error: "missing_args" };

  const { data, error } = await sb.rpc("list_course_members", { p_course_id: courseId });
  if (error) return { rows: [], error: error.message };

  const rows = (data ?? [])
    .filter((m) => m.role === "student")
    .map((m) => ({
      userId: m.user_id,
      displayName: m.display_name || m.email || m.classroom_email || "Alumno",
      email: m.email || m.classroom_email || "",
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));

  return { rows, error: null };
}

/**
 * Crea una actividad del curso vinculada a la lección.
 * @param {{ lessonId: string, courseId: string, title?: string, description?: string, dueAt?: string|null, maxPoints?: string|number|null, studentIds?: string[] }} opts
 */
export async function assignLessonToCourse(opts) {
  const sb = getSupabase();
  if (!sb) return { activity: null, error: "no_supabase" };

  const lessonId = opts?.lessonId;
  const courseId = opts?.courseId;
  if (!lessonId || !courseId) return { activity: null, error: "missing_args" };

  const { data: sessionData } = await sb.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) return { activity: null, error: "no_session" };

  const { lesson, error: lessonErr } = await getLesson(lessonId);
  if (lessonErr || !lesson) {
    return { activity: null, error: lessonErr || "Lección no encontrada." };
  }

  const title = String(opts.title ?? lesson.title ?? "").trim();
  if (!title) return { activity: null, error: "Título requerido" };

  const studentIds = Array.isArray(opts.studentIds)
    ? [...new Set(opts.studentIds.map(String).filter(Boolean))]
    : [];

  if (studentIds.length > 0) {
    const { rows: students, error: rosterErr } = await listCourseStudents(courseId);
    if (rosterErr) return { activity: null, error: rosterErr };
    const allowed = new Set(students.map((s) => s.userId));
    const invalid = studentIds.filter((id) => !allowed.has(id));
    if (invalid.length > 0) {
      return { activity: null, error: "Algunos alumnos no pertenecen a este curso." };
    }
  }

  const payload = {
    course_id: courseId,
    title,
    description: String(opts.description ?? lesson.description ?? "").trim(),
    starter_code: "",
    created_by: userId,
    origin: "pybot",
    content_lesson_id: lessonId,
    due_at: opts.dueAt || null,
    max_points:
      opts.maxPoints != null && opts.maxPoints !== "" ? Number(opts.maxPoints) : null,
  };

  const { data: activity, error: insertErr } = await sb
    .from("activities")
    .insert(payload)
    .select(
      "id, title, description, course_id, content_lesson_id, due_at, max_points, created_at",
    )
    .maybeSingle();

  if (insertErr) {
    if (/content_lesson_id/i.test(insertErr.message)) {
      return {
        activity: null,
        error:
          "Falta aplicar la migración de asignación (20260903000037_content_lesson_assignments.sql).",
      };
    }
    return { activity: null, error: insertErr.message };
  }

  if (studentIds.length > 0) {
    const rows = studentIds.map((uid) => ({
      activity_id: activity.id,
      user_id: uid,
    }));
    const { error: assignErr } = await sb.from("activity_assignees").insert(rows);
    if (assignErr) {
      await sb.from("activities").delete().eq("id", activity.id);
      return { activity: null, error: assignErr.message };
    }
  }

  const contentId = lesson.content_units?.content_id;
  if (contentId) {
    const { content } = await getContent(contentId);
    if (content?.status === "draft") {
      await updateContent(contentId, { status: "published" });
    }
  }

  return { activity, error: null };
}

/**
 * Carga el documento de una lección asignada (lectura).
 */
export async function fetchAssignedLessonDocument(lessonId) {
  const { lesson, error } = await getLesson(lessonId);
  if (error || !lesson) return { lesson: null, document: null, error: error || "not_found" };

  const document = lesson.document_json;
  return {
    lesson,
    document: Array.isArray(document) ? document : null,
    error: null,
  };
}
