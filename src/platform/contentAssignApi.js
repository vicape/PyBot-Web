import { getSupabase } from "../supabaseClient.js";
import { getContent, getLesson, listContentUnits, listUnitLessons } from "./contentApi.js";
import { listPybotclassMyCourses } from "./pybotClassApi.js";

function canAssignAsTeacher(row) {
  const role = row?.my_course_role;
  return role === "teacher" || role === "owner";
}

export async function listTeacherCoursesForAssign() {
  const { rows, error } = await listPybotclassMyCourses(null);
  if (error) return { rows: [], error };
  return {
    rows: (rows ?? []).filter(canAssignAsTeacher),
    error: null,
  };
}

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

function activityKindForSource(sourceType) {
  if (sourceType === "exercise") return "exercise";
  if (sourceType === "task") return "task";
  return "material";
}

function extractBlockFromDocument(documentJson, blockType, blockId) {
  const doc = Array.isArray(documentJson) ? documentJson : [];
  const want = blockType === "exercise" ? "pybotExercise" : "pybotTask";
  if (blockId) {
    const found = doc.find((b) => b?.id === blockId && b?.type === want);
    if (found) return found;
  }
  return doc.find((b) => b?.type === want) || null;
}

/**
 * Construye snapshot inmutable desde Mi Contenido.
 * @param {{ sourceType: string, sourceId: string, blockId?: string, blockProps?: object }} opts
 */
export async function buildContentSnapshot(opts) {
  const sb = getSupabase();
  const sourceType = opts.sourceType;
  const sourceId = opts.sourceId;
  if (!sourceType || !sourceId) return { snapshot: null, error: "missing_args" };

  const { data: sessionData } = await sb.auth.getUser();
  const mediaOwnerId = sessionData?.user?.id || null;

  if (sourceType === "lesson") {
    const { lesson, error } = await getLesson(sourceId);
    if (error || !lesson) return { snapshot: null, error: error || "not_found" };
    const contentId = lesson.content_units?.content_id;
    const { content } = contentId ? await getContent(contentId) : { content: null };
    return {
      snapshot: {
        schemaVersion: 1,
        sourceType: "lesson",
        sourceId: lesson.id,
        title: lesson.title,
        description: lesson.description || "",
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: contentId || null,
        contentTitle: content?.title || "",
        unitId: lesson.unit_id,
        unitTitle: lesson.content_units?.title || "",
        document_json: Array.isArray(lesson.document_json) ? lesson.document_json : [],
      },
      error: null,
    };
  }

  if (sourceType === "unit") {
    const { data: unit, error: uErr } = await sb
      .from("content_units")
      .select("id, content_id, title, description, position")
      .eq("id", sourceId)
      .maybeSingle();
    if (uErr || !unit) return { snapshot: null, error: uErr?.message || "not_found" };
    const { content } = await getContent(unit.content_id);
    const { rows: lessons } = await listUnitLessons(unit.id);
    const lessonSnaps = [];
    for (const l of lessons) {
      const { lesson } = await getLesson(l.id);
      lessonSnaps.push({
        id: l.id,
        title: l.title,
        description: l.description || "",
        position: l.position,
        document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
      });
    }
    return {
      snapshot: {
        schemaVersion: 1,
        sourceType: "unit",
        sourceId: unit.id,
        title: unit.title,
        description: unit.description || "",
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: unit.content_id,
        contentTitle: content?.title || "",
        lessons: lessonSnaps,
      },
      error: null,
    };
  }

  if (sourceType === "content") {
    const { content, error } = await getContent(sourceId);
    if (error || !content) return { snapshot: null, error: error || "not_found" };
    const { rows: units } = await listContentUnits(sourceId);
    const unitSnaps = [];
    for (const u of units) {
      const { rows: lessons } = await listUnitLessons(u.id);
      const lessonSnaps = [];
      for (const l of lessons) {
        const { lesson } = await getLesson(l.id);
        lessonSnaps.push({
          id: l.id,
          title: l.title,
          description: l.description || "",
          position: l.position,
          document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
        });
      }
      unitSnaps.push({
        id: u.id,
        title: u.title,
        description: u.description || "",
        position: u.position,
        lessons: lessonSnaps,
      });
    }
    return {
      snapshot: {
        schemaVersion: 1,
        sourceType: "content",
        sourceId: content.id,
        title: content.title,
        description: content.description || "",
        mediaOwnerId: content.owner_id || mediaOwnerId,
        contentId: content.id,
        contentTitle: content.title,
        units: unitSnaps,
      },
      error: null,
    };
  }

  if (sourceType === "exercise" || sourceType === "task") {
    let props = opts.blockProps || null;
    let lessonMeta = null;
    if (!props) {
      const { lesson, error } = await getLesson(sourceId);
      if (error || !lesson) return { snapshot: null, error: error || "not_found" };
      lessonMeta = lesson;
      const block = extractBlockFromDocument(lesson.document_json, sourceType, opts.blockId);
      if (!block) return { snapshot: null, error: "No se encontró el bloque en la lección." };
      props = block.props || {};
    } else {
      const { lesson } = await getLesson(sourceId);
      lessonMeta = lesson;
    }
    const contentId = lessonMeta?.content_units?.content_id;
    const { content } = contentId ? await getContent(contentId) : { content: null };
    return {
      snapshot: {
        schemaVersion: 1,
        sourceType,
        sourceId,
        title: props.title || (sourceType === "exercise" ? "Ejercicio" : "Tarea"),
        description: props.instructions || "",
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: contentId || null,
        lessonId: sourceId,
        starterCode: props.starterCode || "",
        block: {
          type: sourceType === "exercise" ? "pybotExercise" : "pybotTask",
          title: props.title || "",
          instructions: props.instructions || "",
          starterCode: props.starterCode || "",
        },
      },
      error: null,
    };
  }

  return { snapshot: null, error: "source_type_invalido" };
}

/**
 * Asigna contenido/unidad/lección/ejercicio/tarea creando actividad con snapshot.
 */
export async function assignContentSourceToCourse(opts) {
  const sb = getSupabase();
  if (!sb) return { activity: null, error: "no_supabase" };

  const { sourceType, sourceId, courseId, title, description, dueAt, maxPoints, studentIds, blockId, blockProps } =
    opts || {};
  if (!sourceType || !sourceId || !courseId) return { activity: null, error: "missing_args" };

  const { data: sessionData } = await sb.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) return { activity: null, error: "no_session" };

  const { snapshot, error: snapErr } = await buildContentSnapshot({
    sourceType,
    sourceId,
    blockId,
    blockProps,
  });
  if (snapErr || !snapshot) return { activity: null, error: snapErr || "snapshot_failed" };

  const actTitle = String(title ?? snapshot.title ?? "").trim();
  if (!actTitle) return { activity: null, error: "Título requerido" };

  const ids = Array.isArray(studentIds) ? [...new Set(studentIds.map(String).filter(Boolean))] : [];
  if (ids.length > 0) {
    const { rows: students, error: rosterErr } = await listCourseStudents(courseId);
    if (rosterErr) return { activity: null, error: rosterErr };
    const allowed = new Set(students.map((s) => s.userId));
    if (ids.some((id) => !allowed.has(id))) {
      return { activity: null, error: "Algunos alumnos no pertenecen a este curso." };
    }
  }

  const kind = activityKindForSource(sourceType);
  const starter =
    kind === "material" ? "" : String(snapshot.starterCode || snapshot.block?.starterCode || "");

  const payload = {
    course_id: courseId,
    title: actTitle,
    description: String(description ?? snapshot.description ?? "").trim(),
    starter_code: starter,
    created_by: userId,
    origin: "pybot",
    content_snapshot: snapshot,
    content_source_type: sourceType,
    content_source_id: sourceId,
    activity_kind: kind,
    content_lesson_id: sourceType === "lesson" || sourceType === "exercise" || sourceType === "task" ? sourceId : null,
    due_at: dueAt || null,
    max_points: maxPoints != null && maxPoints !== "" ? Number(maxPoints) : null,
  };

  const { data: activity, error: insertErr } = await sb
    .from("activities")
    .insert(payload)
    .select(
      "id, title, description, course_id, content_snapshot, content_source_type, content_source_id, activity_kind, due_at, max_points, created_at",
    )
    .maybeSingle();

  if (insertErr) {
    if (/content_snapshot|activity_kind|content_source/i.test(insertErr.message)) {
      return {
        activity: null,
        error: "Falta aplicar la migración 20260903000040_content_snapshot_assignments.sql",
      };
    }
    return { activity: null, error: insertErr.message };
  }

  if (ids.length > 0) {
    const { error: assignErr } = await sb.from("activity_assignees").insert(
      ids.map((uid) => ({ activity_id: activity.id, user_id: uid })),
    );
    if (assignErr) {
      await sb.from("activities").delete().eq("id", activity.id);
      return { activity: null, error: assignErr.message };
    }
  }

  return { activity, error: null };
}

/** @deprecated usar assignContentSourceToCourse */
export async function assignLessonToCourse(opts) {
  return assignContentSourceToCourse({
    ...opts,
    sourceType: "lesson",
    sourceId: opts.lessonId,
  });
}

export async function fetchAssignedLessonDocument(lessonId) {
  const { lesson, error } = await getLesson(lessonId);
  if (error || !lesson) return { lesson: null, document: null, error: error || "not_found" };
  return {
    lesson,
    document: Array.isArray(lesson.document_json) ? lesson.document_json : null,
    error: null,
  };
}
