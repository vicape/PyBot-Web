/**
 * Progressive-disclosure helpers for immutable content/unit snapshots.
 * For sourceType="content" and sourceType="unit", builds overview metadata + ordered lessons
 * without mounting every lesson document.
 * Ordered lesson list follows unit order, then lesson position within each unit.
 * Schema v3+ may include frozen items per lesson; legacy snapshots omit items safely.
 */

import { listSnapshotItems } from "./activityItemProgress.js";

function sortByPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
}

function lessonMeta(lesson) {
  return {
    id: lesson.id,
    title: lesson.title || "",
    description: lesson.description || "",
    position: lesson.position,
    itemType: lesson.itemType || "lesson",
    estimatedMinutes: lesson.estimatedMinutes ?? null,
    itemCount: Array.isArray(lesson.items) ? lesson.items.length : 0,
  };
}

function normalizeLessonItems(lesson) {
  if (!Array.isArray(lesson?.items)) return [];
  return [...lesson.items].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      String(a.snapshotItemId || "").localeCompare(String(b.snapshotItemId || "")),
  );
}

/**
 * @param {object|null|undefined} snapshot
 * @returns {{
 *   mode: "multi"|"single"|"empty",
 *   sourceType?: string,
 *   title?: string,
 *   description?: string,
 *   units?: Array<object>,
 *   orderedLessons?: Array<object>,
 *   trackableItems?: Array<object>,
 * } | null}
 */
export function buildSnapshotReaderModel(snapshot) {
  if (!snapshot) return null;

  const sourceType = snapshot.sourceType;
  const trackableItems = listSnapshotItems(snapshot);

  if (sourceType === "unit") {
    const lessons = [...(snapshot.lessons || [])].sort(sortByPosition);
    const orderedLessons = lessons.map((lesson, index) => ({
      ...lessonMeta(lesson),
      document_json: Array.isArray(lesson.document_json) ? lesson.document_json : [],
      items: normalizeLessonItems(lesson),
      unitId: snapshot.sourceId,
      unitTitle: snapshot.title || "",
      flatIndex: index,
    }));

    return {
      mode: "multi",
      sourceType,
      title: snapshot.title || "",
      description: snapshot.description || "",
      units: [
        {
          id: snapshot.sourceId,
          title: snapshot.title || "",
          description: snapshot.description || "",
          unitType: snapshot.unitType || "unit",
          estimatedMinutes: snapshot.estimatedMinutes ?? null,
          lessons: orderedLessons.map(lessonMeta),
        },
      ],
      orderedLessons,
      trackableItems,
    };
  }

  if (sourceType === "content") {
    const units = [...(snapshot.units || [])].sort(sortByPosition);
    const orderedLessons = [];
    const unitViews = [];

    for (const unit of units) {
      const lessons = [...(unit.lessons || [])].sort(sortByPosition);
      const unitLessonMetas = [];
      for (const lesson of lessons) {
        const entry = {
          ...lessonMeta(lesson),
          document_json: Array.isArray(lesson.document_json) ? lesson.document_json : [],
          items: normalizeLessonItems(lesson),
          unitId: unit.id,
          unitTitle: unit.title || "",
          flatIndex: orderedLessons.length,
        };
        orderedLessons.push(entry);
        unitLessonMetas.push(lessonMeta(lesson));
      }
      unitViews.push({
        id: unit.id,
        title: unit.title || "",
        description: unit.description || "",
        unitType: unit.unitType || "unit",
        estimatedMinutes: unit.estimatedMinutes ?? null,
        lessons: unitLessonMetas,
      });
    }

    return {
      mode: "multi",
      sourceType,
      title: snapshot.title || "",
      description: snapshot.description || "",
      units: unitViews,
      orderedLessons,
      trackableItems,
    };
  }

  if (
    sourceType === "lesson" ||
    sourceType === "exercise" ||
    sourceType === "task"
  ) {
    return {
      mode: "single",
      sourceType,
      trackableItems,
      items: sourceType === "lesson" ? normalizeLessonItems(snapshot) : [],
    };
  }

  return { mode: "empty", sourceType, trackableItems: [] };
}

/**
 * @param {Array<object>} orderedLessons
 * @param {string|null|undefined} lessonId
 */
export function findLessonIndex(orderedLessons, lessonId) {
  if (!lessonId || !orderedLessons?.length) return -1;
  return orderedLessons.findIndex((lesson) => lesson.id === lessonId);
}

export { listSnapshotItems };
