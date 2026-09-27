/**
 * Material V2 / Content V3 — pedagogical metadata helpers.
 * Stable internal codes only (not translated labels).
 */

export const CONTENT_DIFFICULTIES = Object.freeze(["beginner", "intermediate", "advanced"]);

export const CONTENT_LANGUAGE_CODES = Object.freeze(["es", "en", "fr", "pt", "de"]);

export const UNIT_TYPES = Object.freeze(["chapter", "unit", "section"]);

/** All valid stored item_type values (legacy + Content V3). */
export const LESSON_ITEM_TYPES = Object.freeze([
  "lesson",
  "theory",
  "example",
  "activity",
  "exercise",
  "quiz",
  "test",
  "project",
  "resource",
  "reading",
  "video",
  "assignment",
]);

/** Canonical Content V3 preferred types for new work. */
export const CONTENT_V3_ITEM_TYPES = Object.freeze([
  "lesson",
  "reading",
  "video",
  "exercise",
  "quiz",
  "assignment",
  "project",
  "resource",
]);

/** Exact types offered when creating directly under a Unit. */
export const UNIT_DIRECT_CREATE_TYPES = Object.freeze([
  "lesson",
  "quiz",
  "assignment",
  "project",
  "resource",
]);

/** Exact types offered when creating inside a Lesson container. */
export const LESSON_CHILD_CREATE_TYPES = Object.freeze([
  "reading",
  "video",
  "exercise",
  "quiz",
  "assignment",
  "resource",
]);

/** Legacy-only types: readable/editable, never offered for NEW creation. */
export const LEGACY_ITEM_TYPES = Object.freeze(["theory", "example", "activity", "test"]);

export const CONTENT_V3_MIGRATION_HINT =
  "Falta aplicar la migración 20260927190051_content_v3_structure.sql";

export const AGE_BOUNDS = Object.freeze({ min: 3, max: 120 });

const CONTENT_META_SELECT = [
  "language_code",
  "recommended_age_min",
  "recommended_age_max",
  "estimated_minutes",
  "difficulty",
  "subject",
  "tags",
  "learning_objectives",
  "prerequisites",
  "copied_from_content_id",
  "original_content_id",
  "original_owner_id",
  "original_creator_id",
  "first_community_published_by_id",
  "first_community_published_at",
].join(", ");

export const LEARNING_CONTENT_SELECT_BASE =
  `id, title, description, status, visibility, preparation_status, owner_id, created_at, updated_at, ${CONTENT_META_SELECT}`;

/** Legacy select when preparation_status column is absent. */
export const LEARNING_CONTENT_SELECT_LEGACY =
  `id, title, description, status, visibility, owner_id, created_at, updated_at, ${CONTENT_META_SELECT}`;

function asTrimmedOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function asPositiveIntOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { error: "estimated_minutes_invalid" };
  }
  return n;
}

function asAgeOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: "age_invalid" };
  }
  if (n < AGE_BOUNDS.min || n > AGE_BOUNDS.max) {
    return { error: "age_out_of_bounds" };
  }
  return n;
}

function asStringArray(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Normalize/validate metadata patch for create/update.
 * @returns {{ patch: object, error: string|null }}
 */
export function normalizeContentMetadataPatch(input = {}) {
  const patch = {};
  const src = input || {};

  if (src.language_code !== undefined) {
    const code = asTrimmedOrNull(src.language_code);
    if (code && !CONTENT_LANGUAGE_CODES.includes(code) && !/^[a-z]{2}(-[A-Za-z0-9]+)?$/.test(code)) {
      return { patch: {}, error: "language_code_invalid" };
    }
    patch.language_code = code;
  }

  if (src.difficulty !== undefined) {
    const d = asTrimmedOrNull(src.difficulty);
    if (d && !CONTENT_DIFFICULTIES.includes(d)) {
      return { patch: {}, error: "difficulty_invalid" };
    }
    patch.difficulty = d;
  }

  if (src.subject !== undefined) {
    patch.subject = asTrimmedOrNull(src.subject);
  }

  if (src.recommended_age_min !== undefined) {
    const age = asAgeOrNull(src.recommended_age_min);
    if (age && typeof age === "object" && age.error) return { patch: {}, error: age.error };
    patch.recommended_age_min = age;
  }

  if (src.recommended_age_max !== undefined) {
    const age = asAgeOrNull(src.recommended_age_max);
    if (age && typeof age === "object" && age.error) return { patch: {}, error: age.error };
    patch.recommended_age_max = age;
  }

  if (src.estimated_minutes !== undefined) {
    const mins = asPositiveIntOrNull(src.estimated_minutes);
    if (mins && typeof mins === "object" && mins.error) return { patch: {}, error: mins.error };
    patch.estimated_minutes = mins;
  }

  if (src.tags !== undefined) patch.tags = asStringArray(src.tags);
  if (src.learning_objectives !== undefined) {
    patch.learning_objectives = asStringArray(src.learning_objectives);
  }
  if (src.prerequisites !== undefined) patch.prerequisites = asStringArray(src.prerequisites);

  const min = patch.recommended_age_min !== undefined ? patch.recommended_age_min : src.recommended_age_min;
  const max = patch.recommended_age_max !== undefined ? patch.recommended_age_max : src.recommended_age_max;
  const minN = min === "" || min === undefined ? null : min;
  const maxN = max === "" || max === undefined ? null : max;
  if ((minN == null) !== (maxN == null)) {
    return { patch: {}, error: "age_range_incomplete" };
  }
  if (minN != null && maxN != null && Number(minN) > Number(maxN)) {
    return { patch: {}, error: "age_range_inverted" };
  }

  return { patch, error: null };
}

/** Fields required to publish to COMMUNITY. */
export function communityMetadataGaps(content) {
  const gaps = [];
  if (!String(content?.title || "").trim()) gaps.push("title");
  if (!String(content?.language_code || "").trim()) gaps.push("language");
  if (content?.recommended_age_min == null || content?.recommended_age_max == null) {
    gaps.push("age_range");
  }
  if (content?.estimated_minutes == null || Number(content.estimated_minutes) <= 0) {
    gaps.push("estimated_time");
  }
  if (!CONTENT_DIFFICULTIES.includes(content?.difficulty)) gaps.push("difficulty");
  return gaps;
}

export function isCommunityMetadataComplete(content) {
  return communityMetadataGaps(content).length === 0;
}

export function normalizeUnitType(value) {
  const v = String(value || "unit").trim();
  return UNIT_TYPES.includes(v) ? v : "unit";
}

export function normalizeItemType(value) {
  const v = String(value || "lesson").trim();
  return LESSON_ITEM_TYPES.includes(v) ? v : "lesson";
}

export function isLegacyItemType(value) {
  return LEGACY_ITEM_TYPES.includes(String(value || "").trim());
}

/**
 * Type options when editing an existing item.
 * Legacy current type is kept + valid V3 types for context; never duplicates.
 */
export function itemTypeOptionsForEdit({ itemType, parentLessonId = null } = {}) {
  const contextTypes = parentLessonId != null ? LESSON_CHILD_CREATE_TYPES : UNIT_DIRECT_CREATE_TYPES;
  const current = String(itemType || "").trim();
  const normalized = normalizeItemType(current);
  const options = [];
  if (isLegacyItemType(current) || isLegacyItemType(normalized)) {
    const legacy = isLegacyItemType(current) ? current : normalized;
    if (!options.includes(legacy)) options.push(legacy);
  }
  for (const t of contextTypes) {
    if (!options.includes(t)) options.push(t);
  }
  return options;
}

/** In-memory only: never written back when V3 column is absent. */
export function derivePreparationStatus(row) {
  if (row && row.preparation_status != null && row.preparation_status !== "") {
    return row.preparation_status;
  }
  return row?.status === "published" ? "ready" : "draft";
}

export function pickContentMetadata(row) {
  if (!row) return null;
  return {
    language_code: row.language_code ?? null,
    recommended_age_min: row.recommended_age_min ?? null,
    recommended_age_max: row.recommended_age_max ?? null,
    estimated_minutes: row.estimated_minutes ?? null,
    difficulty: row.difficulty ?? null,
    subject: row.subject ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    learning_objectives: Array.isArray(row.learning_objectives) ? row.learning_objectives : [],
    prerequisites: Array.isArray(row.prerequisites) ? row.prerequisites : [],
    copied_from_content_id: row.copied_from_content_id ?? null,
    original_content_id: row.original_content_id ?? null,
    original_owner_id: row.original_owner_id ?? null,
    original_creator_id: row.original_creator_id ?? null,
    first_community_published_by_id: row.first_community_published_by_id ?? null,
    first_community_published_at: row.first_community_published_at ?? null,
  };
}
