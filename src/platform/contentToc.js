/**
 * Automatic Table of Contents derived ONLY from ordered Units -> Lessons -> Items.
 * No stored duplicate TOC — call after create/rename/delete/duplicate/move/reorder.
 */

import { mapLegacyItemType, normalizeUnitType } from "./contentMetadata.js";

/**
 * @param {Array<{ id: string, title: string, unit_type?: string, estimated_minutes?: number|null, position?: number }>} units
 * @param {Record<string, Array<{ id: string, title: string, position?: number, unit_id?: string }>>} lessonsByUnit
 * @param {Record<string, Array<{ id: string, title: string, type?: string, item_type?: string, position?: number, lesson_id?: string }>>} [itemsByLesson]
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
        const numberLabel = `${unitNumber}.${lessonIndex + 1}`;
        const childRows = [...(itemsByLesson[lesson.id] || [])].sort(
          (a, b) =>
            (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)),
        );

        return {
          id: lesson.id,
          kind: "lesson",
          itemType: "lesson",
          title: lesson.title || "",
          numberLabel,
          estimatedMinutes: lesson.estimated_minutes ?? null,
          unitId: unit.id,
          parentLessonId: null,
          anchor: `lesson-${lesson.id}`,
          children: childRows.map((child, childIndex) => {
            const itemType = mapLegacyItemType(child.type ?? child.item_type);
            return {
              id: child.id,
              kind: "item",
              itemType,
              title: child.title || "",
              numberLabel: `${numberLabel}.${childIndex + 1}`,
              estimatedMinutes: child.config?.estimated_minutes ?? child.estimated_minutes ?? null,
              unitId: unit.id,
              parentLessonId: lesson.id,
              lessonId: lesson.id,
              anchor: `item-${child.id}`,
              children: [],
            };
          }),
        };
      }),
    };
  });
}
