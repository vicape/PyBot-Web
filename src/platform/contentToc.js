/**
 * Automatic Table of Contents derived ONLY from ordered units + lessons (+ optional children).
 * No stored duplicate TOC — call after create/rename/delete/retype/reorder.
 */

import { normalizeItemType, normalizeUnitType } from "./contentMetadata.js";

/**
 * @param {Array<{ id: string, title: string, unit_type?: string, estimated_minutes?: number|null, position?: number }>} units
 * @param {Record<string, Array<{ id: string, title: string, item_type?: string, estimated_minutes?: number|null, position?: number, unit_id?: string }>>} lessonsByUnit
 * @param {Record<string, Array<{ id: string, title: string, item_type?: string, estimated_minutes?: number|null, position?: number, unit_id?: string, parent_lesson_id?: string }>>} [itemsByLesson]
 * @returns {Array<object>}
 */
export function deriveContentToc(units = [], lessonsByUnit = {}, itemsByLesson = {}) {
  const orderedUnits = [...(units || [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)),
  );

  return orderedUnits.map((unit, unitIndex) => {
    const unitNumber = unitIndex + 1;
    const lessons = [...(lessonsByUnit[unit.id] || [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)),
    );

    return {
      id: unit.id,
      kind: "unit",
      unitType: normalizeUnitType(unit.unit_type),
      title: unit.title || "",
      numberLabel: String(unitNumber),
      estimatedMinutes: unit.estimated_minutes ?? null,
      anchor: `unit-${unit.id}`,
      children: lessons.map((lesson, lessonIndex) => {
        const itemType = normalizeItemType(lesson.item_type);
        const numberLabel = `${unitNumber}.${lessonIndex + 1}`;
        const childRows =
          itemType === "lesson"
            ? [...(itemsByLesson[lesson.id] || [])].sort(
                (a, b) =>
                  (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)),
              )
            : [];

        return {
          id: lesson.id,
          kind: "item",
          itemType,
          title: lesson.title || "",
          numberLabel,
          estimatedMinutes: lesson.estimated_minutes ?? null,
          unitId: unit.id,
          parentLessonId: null,
          anchor: `lesson-${lesson.id}`,
          children:
            itemType === "lesson"
              ? childRows.map((child, childIndex) => ({
                  id: child.id,
                  kind: "item",
                  itemType: normalizeItemType(child.item_type),
                  title: child.title || "",
                  numberLabel: `${numberLabel}.${childIndex + 1}`,
                  estimatedMinutes: child.estimated_minutes ?? null,
                  unitId: unit.id,
                  parentLessonId: lesson.id,
                  anchor: `lesson-${child.id}`,
                  children: [],
                }))
              : [],
        };
      }),
    };
  });
}
