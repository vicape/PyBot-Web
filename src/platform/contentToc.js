/**
 * Automatic Table of Contents derived ONLY from ordered units + lessons.
 * No stored duplicate TOC — call after create/rename/delete/retype/reorder.
 */

import { normalizeItemType, normalizeUnitType } from "./contentMetadata.js";

/**
 * @param {Array<{ id: string, title: string, unit_type?: string, estimated_minutes?: number|null, position?: number }>} units
 * @param {Record<string, Array<{ id: string, title: string, item_type?: string, estimated_minutes?: number|null, position?: number }>>} lessonsByUnit
 * @returns {Array<object>}
 */
export function deriveContentToc(units = [], lessonsByUnit = {}) {
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
      children: lessons.map((lesson, lessonIndex) => ({
        id: lesson.id,
        kind: "item",
        itemType: normalizeItemType(lesson.item_type),
        title: lesson.title || "",
        numberLabel: `${unitNumber}.${lessonIndex + 1}`,
        estimatedMinutes: lesson.estimated_minutes ?? null,
        unitId: unit.id,
        anchor: `lesson-${lesson.id}`,
      })),
    };
  });
}
