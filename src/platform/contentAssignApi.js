import { getSupabase } from "../supabaseClient.js";
import {
  copyLearningContent,
  getContent,
  getLesson,
  listContentUnits,
  listLessonItems,
  listUnitLessons,
} from "./contentApi.js";
import { pickContentMetadata } from "./contentMetadata.js";
import { normalizeCourseRole } from "./courseRole.js";
import { listPybotclassMyCourses } from "./pybotClassApi.js";

/** Schema v3 freezes Unit → Lesson → Item. Legacy v1/v2 snapshots remain readable. */
export const CONTENT_SNAPSHOT_SCHEMA_VERSION = 3;

/**
 * Freeze a live content_items row into snapshot shape.
 * snapshotItemId is stable for the assignment lifetime; sourceItemId is audit-only.
 */
export function freezeSnapshotItem(item) {
  if (!item?.id) return null;
  const type = item.type || item.item_type || "material";
  const content = item.content && typeof item.content === "object" ? item.content : {};
  const config = item.config && typeof item.config === "object" ? item.config : {};
  return {
    snapshotItemId: String(item.id),
    sourceItemId: item.id,
    type,
    title: item.title || "",
    position: item.position ?? 0,
    content: JSON.parse(JSON.stringify(content)),
    config: JSON.parse(JSON.stringify(config)),
  };
}

async function loadFrozenLessonItems(lessonId) {
  if (!lessonId) return [];
  const { rows, error } = await listLessonItems(lessonId);
  if (error) {
    // Missing content_items migration: assign without items (legacy-compatible).
    if (/content_items|migración|migration/i.test(String(error))) return [];
    return [];
  }
  return (rows || []).map(freezeSnapshotItem).filter(Boolean);
}

function contentMetaForSnapshot(content) {
  const meta = pickContentMetadata(content) || {};
  return {
    language_code: meta.language_code ?? null,
    recommended_age_min: meta.recommended_age_min ?? null,
    recommended_age_max: meta.recommended_age_max ?? null,
    estimated_minutes: meta.estimated_minutes ?? null,
    difficulty: meta.difficulty ?? null,
    subject: meta.subject ?? null,
    tags: meta.tags ?? [],
    learning_objectives: meta.learning_objectives ?? [],
    prerequisites: meta.prerequisites ?? [],
    copied_from_content_id: meta.copied_from_content_id ?? null,
    original_content_id: meta.original_content_id ?? null,
    original_owner_id: meta.original_owner_id ?? null,
    original_creator_id: meta.original_creator_id ?? null,
    first_community_published_by_id: meta.first_community_published_by_id ?? null,
    first_community_published_at: meta.first_community_published_at ?? null,
  };
}

function canAssignAsTeacher(row) {
  return normalizeCourseRole(row?.my_course_role) === "teacher";
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
    const items = await loadFrozenLessonItems(lesson.id);
    return {
      snapshot: {
        schemaVersion: CONTENT_SNAPSHOT_SCHEMA_VERSION,
        sourceType: "lesson",
        sourceId: lesson.id,
        title: lesson.title,
        description: lesson.description || "",
        itemType: "lesson",
        estimatedMinutes: lesson.estimated_minutes ?? null,
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: contentId || null,
        contentTitle: content?.title || "",
        contentMeta: contentMetaForSnapshot(content),
        unitId: lesson.unit_id,
        unitTitle: lesson.content_units?.title || "",
        unitType: lesson.content_units?.unit_type || "unit",
        document_json: Array.isArray(lesson.document_json) ? lesson.document_json : [],
        items,
      },
      error: null,
    };
  }

  if (sourceType === "unit") {
    const { data: unit, error: uErr } = await sb
      .from("content_units")
      .select("id, content_id, title, description, position, unit_type, estimated_minutes")
      .eq("id", sourceId)
      .maybeSingle();
    if (uErr || !unit) return { snapshot: null, error: uErr?.message || "not_found" };
    const { content } = await getContent(unit.content_id);
    const { rows: lessons } = await listUnitLessons(unit.id);
    const lessonSnaps = [];
    for (const l of lessons) {
      const { lesson } = await getLesson(l.id);
      const items = await loadFrozenLessonItems(l.id);
      lessonSnaps.push({
        id: l.id,
        title: l.title,
        description: l.description || "",
        position: l.position,
        itemType: "lesson",
        estimatedMinutes: l.estimated_minutes ?? lesson?.estimated_minutes ?? null,
        document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
        items,
      });
    }
    return {
      snapshot: {
        schemaVersion: CONTENT_SNAPSHOT_SCHEMA_VERSION,
        sourceType: "unit",
        sourceId: unit.id,
        title: unit.title,
        description: unit.description || "",
        unitType: unit.unit_type || "unit",
        estimatedMinutes: unit.estimated_minutes ?? null,
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: unit.content_id,
        contentTitle: content?.title || "",
        contentMeta: contentMetaForSnapshot(content),
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
        const items = await loadFrozenLessonItems(l.id);
        lessonSnaps.push({
          id: l.id,
          title: l.title,
          description: l.description || "",
          position: l.position,
          itemType: "lesson",
          estimatedMinutes: l.estimated_minutes ?? lesson?.estimated_minutes ?? null,
          document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
          items,
        });
      }
      unitSnaps.push({
        id: u.id,
        title: u.title,
        description: u.description || "",
        position: u.position,
        unitType: u.unit_type || "unit",
        estimatedMinutes: u.estimated_minutes ?? null,
        lessons: lessonSnaps,
      });
    }
    return {
      snapshot: {
        schemaVersion: CONTENT_SNAPSHOT_SCHEMA_VERSION,
        sourceType: "content",
        sourceId: content.id,
        title: content.title,
        description: content.description || "",
        mediaOwnerId: content.owner_id || mediaOwnerId,
        contentId: content.id,
        contentTitle: content.title,
        contentMeta: contentMetaForSnapshot(content),
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
        schemaVersion: CONTENT_SNAPSHOT_SCHEMA_VERSION,
        sourceType,
        sourceId,
        title: props.title || (sourceType === "exercise" ? "Ejercicio" : "Tarea"),
        description: props.instructions || "",
        itemType: sourceType,
        mediaOwnerId: content?.owner_id || mediaOwnerId,
        contentId: contentId || null,
        contentMeta: contentMetaForSnapshot(content),
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
 * Find or create a teacher-owned copy of community/shared content.
 * Reuses an existing copy where owner_id = me AND copied_from_content_id = source.
 * Never mutates the community original.
 */
export async function ensureTeacherOwnedContentCopy(sourceContentId) {
  const sb = getSupabase();
  if (!sb || !sourceContentId) return { content: null, reused: false, error: "missing_args" };

  const { data: sessionData } = await sb.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) return { content: null, reused: false, error: "no_session" };

  const { content: source, error: srcErr } = await getContent(sourceContentId);
  if (srcErr || !source) return { content: null, reused: false, error: srcErr || "not_found" };

  if (source.owner_id === userId) {
    return { content: source, reused: true, error: null, alreadyOwned: true };
  }

  const { data: existing, error: findErr } = await sb
    .from("learning_contents")
    .select("id, owner_id, title, copied_from_content_id, original_content_id, original_owner_id, original_creator_id")
    .eq("owner_id", userId)
    .eq("copied_from_content_id", sourceContentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!findErr && existing?.id) {
    const { content, error } = await getContent(existing.id);
    if (!error && content) return { content, reused: true, error: null };
  }

  const { content: copy, error: copyErr } = await copyLearningContent(sourceContentId);
  if (copyErr || !copy) return { content: null, reused: false, error: copyErr || "copy_failed" };
  return { content: copy, reused: false, error: null };
}

/**
 * Asigna contenido/unidad/lección/ejercicio/tarea creando actividad con snapshot.
 * When copyBeforeAssign is true (Community / SharedContentPage), first create/reuse a
 * teacher-owned copy, then snapshot from that copy — never the community author's live content.
 */
export async function assignContentSourceToCourse(opts) {
  const sb = getSupabase();
  if (!sb) return { activity: null, error: "no_supabase" };

  let {
    sourceType,
    sourceId,
    courseId,
    title,
    description,
    dueAt,
    maxPoints,
    studentIds,
    blockId,
    blockProps,
    copyBeforeAssign = false,
  } = opts || {};
  if (!sourceType || !sourceId || !courseId) return { activity: null, error: "missing_args" };

  const { data: sessionData } = await sb.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) return { activity: null, error: "no_session" };

  let teacherCopyMeta = null;
  if (copyBeforeAssign && sourceType === "content") {
    const { content: owned, error: copyErr, reused, alreadyOwned } =
      await ensureTeacherOwnedContentCopy(sourceId);
    if (copyErr || !owned) return { activity: null, error: copyErr || "copy_before_assign_failed" };
    sourceId = owned.id;
    teacherCopyMeta = {
      teacherOwnedCopyId: owned.id,
      reused: Boolean(reused),
      alreadyOwned: Boolean(alreadyOwned),
      copiedFromContentId: owned.copied_from_content_id ?? null,
      originalContentId: owned.original_content_id ?? null,
      originalOwnerId: owned.original_owner_id ?? null,
      originalCreatorId: owned.original_creator_id ?? null,
    };
  }

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

  return { activity, error: null, teacherCopy: teacherCopyMeta };
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
