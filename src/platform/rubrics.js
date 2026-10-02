/**
 * Point 9 — Generic multidimensional rubrics.
 * Evolves existing activity_rubrics / criteria / submission scores.
 * Structure: rubric -> criteria -> achievement levels.
 * Scoring modes: exactly one of `qualitative` | `points`.
 *
 * Closure path: activity -> activity_submission -> rubric evaluation
 * Official numeric grade remains activity_submissions.grade (never invent grade=0).
 * Points mode ceiling must match activities.max_points (no silent rescale).
 * CASE E: 4 + 3 + 5 -> official grade 12; P6 consumes 12/max_points once (no double count).
 * Preserve activity_item_submissions; P9 does not create a second embedded rubric engine.
 * No unresolved DECISION REQUIRED for the P9 product rules above.
 */

export const RUBRIC_SCORING_MODES = Object.freeze(["qualitative", "points"]);
export const RUBRIC_SCHEMA_LEGACY = 1;
export const RUBRIC_SCHEMA_P9 = 2;

export function isRubricScoringMode(mode) {
  return mode === "qualitative" || mode === "points";
}

export function normalizeScoringMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "qualitative" || m === "points") return m;
  return null;
}

/** Stable sort by sort_order then name then id. */
export function sortByOrder(rows = []) {
  return [...rows].sort((a, b) => {
    const ao = Number(a?.sort_order ?? a?.sortOrder ?? 0);
    const bo = Number(b?.sort_order ?? b?.sortOrder ?? 0);
    if (ao !== bo) return ao - bo;
    const an = String(a?.name || "");
    const bn = String(b?.name || "");
    if (an !== bn) return an.localeCompare(bn);
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

/**
 * Detect legacy gen-1 criteria: numeric max_points, no achievement levels.
 * Do NOT invent level semantics for these rows.
 */
export function isLegacyRubricCriterion(criterion) {
  const levels = criterion?.levels || criterion?.achievement_levels || [];
  if (Array.isArray(levels) && levels.length > 0) return false;
  const max = criterion?.max_points ?? criterion?.maxPoints;
  return max != null && max !== "" && Number.isFinite(Number(max));
}

export function isLegacyActivityRubric(rubric, criteria = []) {
  if (!rubric && (!criteria || criteria.length === 0)) return false;
  const gen = Number(rubric?.schema_generation ?? rubric?.schemaGeneration);
  if (gen === RUBRIC_SCHEMA_LEGACY) return true;
  if (gen === RUBRIC_SCHEMA_P9) return false;
  if (!criteria.length) return false;
  return criteria.every((c) => isLegacyRubricCriterion(c));
}

export function normalizeLevelInput(level, { scoringMode, index = 0 } = {}) {
  const name = String(level?.name || "").trim();
  if (!name) return { ok: false, error: "level_name_required" };
  const descriptor =
    level?.descriptor != null && String(level.descriptor).trim() !== ""
      ? String(level.descriptor).trim()
      : level?.description != null && String(level.description).trim() !== ""
        ? String(level.description).trim()
        : null;
  const sortOrder = Number.isFinite(Number(level?.sort_order ?? level?.sortOrder))
    ? Number(level?.sort_order ?? level?.sortOrder)
    : index;
  let points = null;
  if (scoringMode === "points") {
    const raw = level?.points ?? level?.value;
    if (raw == null || raw === "") return { ok: false, error: "level_points_required" };
    points = Number(raw);
    if (!Number.isFinite(points) || points < 0) return { ok: false, error: "invalid_level_points" };
  } else if (scoringMode === "qualitative") {
    // Points must not be required; ignore client numeric if present.
    points = null;
  }
  return {
    ok: true,
    level: {
      id: level?.id || null,
      name,
      descriptor,
      sort_order: sortOrder,
      points,
    },
  };
}

export function normalizeCriterionInput(criterion, { scoringMode, index = 0, allowLegacy = false } = {}) {
  const name = String(criterion?.name || "").trim();
  if (!name) return { ok: false, error: "criterion_name_required" };
  const description =
    criterion?.description != null && String(criterion.description).trim() !== ""
      ? String(criterion.description).trim()
      : null;
  const sortOrder = Number.isFinite(Number(criterion?.sort_order ?? criterion?.sortOrder))
    ? Number(criterion?.sort_order ?? criterion?.sortOrder)
    : index;

  const rawLevels = criterion?.levels || criterion?.achievement_levels || [];
  const isLegacy =
    allowLegacy &&
    (!Array.isArray(rawLevels) || rawLevels.length === 0) &&
    (criterion?.max_points != null || criterion?.maxPoints != null);

  if (isLegacy) {
    const maxPoints = Number(criterion?.max_points ?? criterion?.maxPoints);
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) {
      return { ok: false, error: "invalid_criterion_max" };
    }
    return {
      ok: true,
      criterion: {
        id: criterion?.id || null,
        name,
        description,
        sort_order: sortOrder,
        max_points: maxPoints,
        levels: [],
        legacy: true,
      },
    };
  }

  if (!Array.isArray(rawLevels) || rawLevels.length < 1) {
    return { ok: false, error: "levels_required" };
  }

  const levels = [];
  for (let i = 0; i < rawLevels.length; i += 1) {
    const lr = normalizeLevelInput(rawLevels[i], { scoringMode, index: i });
    if (!lr.ok) return lr;
    levels.push(lr.level);
  }

  let maxPoints = null;
  if (scoringMode === "points") {
    maxPoints = levels.reduce((m, lv) => Math.max(m, Number(lv.points)), 0);
  }

  return {
    ok: true,
    criterion: {
      id: criterion?.id || null,
      name,
      description,
      sort_order: sortOrder,
      max_points: maxPoints,
      levels: sortByOrder(levels),
      legacy: false,
    },
  };
}

/**
 * Normalize a reusable teacher template or activity rubric payload.
 * Arbitrary criterion count and arbitrary achievement-level count.
 */
export function normalizeRubricDefinition(
  {
    name = null,
    description = null,
    scoring_mode = null,
    scoringMode = null,
    criteria = [],
  } = {},
  { requireName = false, allowLegacy = false } = {},
) {
  const mode = normalizeScoringMode(scoring_mode ?? scoringMode);
  if (!mode) return { ok: false, error: "scoring_mode_required" };

  const title = name != null ? String(name).trim() : "";
  if (requireName && !title) return { ok: false, error: "rubric_name_required" };

  if (!Array.isArray(criteria) || criteria.length < 1) {
    return { ok: false, error: "criteria_required" };
  }

  const normalized = [];
  for (let i = 0; i < criteria.length; i += 1) {
    const cr = normalizeCriterionInput(criteria[i], {
      scoringMode: mode,
      index: i,
      allowLegacy,
    });
    if (!cr.ok) return cr;
    normalized.push(cr.criterion);
  }

  return {
    ok: true,
    rubric: {
      name: title || null,
      description:
        description != null && String(description).trim() !== ""
          ? String(description).trim()
          : null,
      scoring_mode: mode,
      criteria: sortByOrder(normalized),
      schema_generation: normalized.every((c) => c.legacy) ? RUBRIC_SCHEMA_LEGACY : RUBRIC_SCHEMA_P9,
    },
  };
}

/** Max obtainable total for points-mode rubric (= sum of each criterion's max level points). */
export function rubricPointsCeiling(criteria = []) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  let total = 0;
  for (const c of criteria) {
    if (c?.legacy) {
      const m = Number(c.max_points ?? c.maxPoints);
      if (!Number.isFinite(m)) return null;
      total += m;
      continue;
    }
    const levels = c?.levels || [];
    if (!levels.length) {
      const m = Number(c?.max_points ?? c?.maxPoints);
      if (!Number.isFinite(m)) return null;
      total += m;
      continue;
    }
    let max = -Infinity;
    for (const lv of levels) {
      const p = Number(lv?.points);
      if (!Number.isFinite(p)) return null;
      if (p > max) max = p;
    }
    if (!Number.isFinite(max)) return null;
    total += max;
  }
  return total;
}

export function rubricMatchesActivityMaxPoints(criteria, maxPoints, scoringMode) {
  if (scoringMode === "qualitative") return true;
  const sum = rubricPointsCeiling(criteria);
  const max = Number(maxPoints);
  if (sum == null || !Number.isFinite(max)) return false;
  return Math.abs(sum - max) < 0.0001;
}

/**
 * Independent frozen snapshot from a mutable template.
 * New identities; no live FK dependency for pedagogy.
 */
export function snapshotTemplateToActivityRubric(template, { activityId = null } = {}) {
  const normalized = normalizeRubricDefinition(
    {
      name: template?.name,
      description: template?.description,
      scoring_mode: template?.scoring_mode ?? template?.scoringMode,
      criteria: template?.criteria || [],
    },
    { requireName: false, allowLegacy: false },
  );
  if (!normalized.ok) return normalized;

  const frozenCriteria = normalized.rubric.criteria.map((c, ci) => {
    const criterionId = `frozen-${activityId || "act"}-c-${ci + 1}-${c.name}`;
    return {
      id: criterionId,
      name: c.name,
      description: c.description,
      sort_order: c.sort_order,
      max_points: c.max_points,
      levels: (c.levels || []).map((lv, li) => ({
        id: `frozen-${activityId || "act"}-l-${ci + 1}-${li + 1}-${lv.name}`,
        criterion_id: criterionId,
        name: lv.name,
        descriptor: lv.descriptor,
        sort_order: lv.sort_order,
        points: lv.points,
      })),
    };
  });

  return {
    ok: true,
    activityRubric: {
      activity_id: activityId,
      scoring_mode: normalized.rubric.scoring_mode,
      schema_generation: RUBRIC_SCHEMA_P9,
      source_template_id: template?.id || null,
      frozen_at: template?.frozen_at || "NOW",
      criteria: frozenCriteria,
    },
  };
}

/** Mutating the template must not alter an existing frozen activity rubric. */
export function templateEditAffectsSnapshot(snapshot, editedTemplate) {
  if (!snapshot?.criteria || !editedTemplate) return false;
  // Structural independence: snapshot fields are copied values, not live refs.
  const snap = JSON.stringify(
    (snapshot.criteria || []).map((c) => ({
      name: c.name,
      description: c.description,
      levels: (c.levels || []).map((l) => ({
        name: l.name,
        descriptor: l.descriptor,
        points: l.points,
      })),
    })),
  );
  const fromTemplate = snapshotTemplateToActivityRubric(editedTemplate);
  if (!fromTemplate.ok) return true;
  const next = JSON.stringify(
    (fromTemplate.activityRubric.criteria || []).map((c) => ({
      name: c.name,
      description: c.description,
      levels: (c.levels || []).map((l) => ({
        name: l.name,
        descriptor: l.descriptor,
        points: l.points,
      })),
    })),
  );
  // Even if template content equals snapshot after edit, identities differ;
  // pedagogical independence is proven by separate objects / ids.
  return snap !== next ? "content_diverged_but_snapshot_unchanged" : "snapshot_independent";
}

/**
 * Server-authoritative points from frozen level identity.
 * Client-supplied points must never override.
 */
export function resolveAuthoritativeLevelPoints(frozenCriteria, criterionId, levelId, clientPoints) {
  void clientPoints; // intentionally ignored
  const criterion = (frozenCriteria || []).find((c) => c.id === criterionId);
  if (!criterion) return { ok: false, error: "invalid_criterion" };
  if (isLegacyRubricCriterion(criterion)) {
    return { ok: false, error: "legacy_requires_points_path" };
  }
  const level = (criterion.levels || []).find((l) => l.id === levelId);
  if (!level) return { ok: false, error: "invalid_level" };
  if (level.points == null || level.points === "") {
    return { ok: true, points: null, level, criterion };
  }
  const points = Number(level.points);
  if (!Number.isFinite(points)) return { ok: false, error: "invalid_level_points" };
  return { ok: true, points, level, criterion };
}

export function sumAuthoritativeRubricPoints(selections, frozenCriteria, scoringMode) {
  if (scoringMode === "qualitative") return { ok: true, total: null };
  let total = 0;
  for (const sel of selections || []) {
    const resolved = resolveAuthoritativeLevelPoints(
      frozenCriteria,
      sel.criterion_id ?? sel.criterionId,
      sel.level_id ?? sel.levelId,
      sel.points,
    );
    if (!resolved.ok) return resolved;
    if (resolved.points == null) return { ok: false, error: "level_points_required" };
    total += resolved.points;
  }
  return { ok: true, total };
}

/**
 * Simulate grade_activity_submission P9 behaviour (server-side).
 * Writes official activity_submissions.grade; qualitative must not invent grade=0.
 * Points mode rejects when rubric ceiling mismatches activities.max_points.
 */
export function simulateGradeActivitySubmission({
  submission,
  activity,
  activityRubric,
  criteria = [],
  p_grade = null,
  p_feedback = null,
  p_rubric_scores = null,
  actorIsTeacher = true,
} = {}) {
  if (!actorIsTeacher) return { ok: false, error: "forbidden" };
  if (!submission) return { ok: false, error: "not_found" };
  if (!["submitted", "returned", "graded"].includes(submission.status)) {
    return { ok: false, error: "invalid_transition" };
  }

  const hasRubric = Boolean(activityRubric) && Array.isArray(criteria) && criteria.length > 0;
  if (!hasRubric) {
    if (p_grade == null || p_grade === "") return { ok: false, error: "grade_required" };
    const grade = Number(p_grade);
    if (!Number.isFinite(grade) || grade < 0) return { ok: false, error: "grade_negative" };
    const max = activity?.max_points != null ? Number(activity.max_points) : null;
    if (max != null && Number.isFinite(max) && grade > max) {
      return { ok: false, error: "grade_exceeds_max" };
    }
    return {
      ok: true,
      grade,
      feedback: p_feedback,
      status: "graded",
      rubric_scores: [],
      submission_id: submission.id,
    };
  }

  const scoringMode =
    normalizeScoringMode(activityRubric.scoring_mode ?? activityRubric.scoringMode) || "points";
  const legacy = isLegacyActivityRubric(activityRubric, criteria);

  if (!Array.isArray(p_rubric_scores)) {
    return { ok: false, error: "rubric_scores_required" };
  }

  if (!legacy && scoringMode === "points") {
    if (!rubricMatchesActivityMaxPoints(criteria, activity?.max_points, scoringMode)) {
      return {
        ok: false,
        error: "rubric_max_mismatch",
        rubric_sum: rubricPointsCeiling(criteria),
        max_points: activity?.max_points ?? null,
      };
    }
  }

  if (legacy) {
    // Gen-1: client points within criterion max; no invented levels.
    if (activity?.max_points != null) {
      const sumMax = criteria.reduce((s, c) => s + Number(c.max_points ?? c.maxPoints), 0);
      if (Math.abs(sumMax - Number(activity.max_points)) > 0.0001) {
        return {
          ok: false,
          error: "rubric_max_mismatch",
          rubric_sum: sumMax,
          max_points: activity.max_points,
        };
      }
    }
    const scored = [];
    let total = 0;
    const byCrit = new Map((p_rubric_scores || []).map((s) => [s.criterion_id ?? s.criterionId, s]));
    for (const c of criteria) {
      const sel = byCrit.get(c.id);
      if (!sel) return { ok: false, error: "missing_criterion_id" };
      const points = Number(sel.points);
      const max = Number(c.max_points ?? c.maxPoints);
      if (!Number.isFinite(points) || points < 0 || points > max) {
        return { ok: false, error: "criterion_points_out_of_range" };
      }
      scored.push({
        submission_id: submission.id,
        criterion_id: c.id,
        level_id: null,
        level_name: null,
        level_descriptor: null,
        points,
        comment: sel.comment ?? null,
      });
      total += points;
    }
    return {
      ok: true,
      grade: total,
      feedback: p_feedback,
      status: "graded",
      rubric_scores: scored,
      submission_id: submission.id,
    };
  }

  // P9 with levels: require one level per criterion.
  if (p_rubric_scores.length !== criteria.length) {
    // Allow extra ignored, but require all criteria present
  }
  const byCrit = new Map(
    (p_rubric_scores || []).map((s) => [String(s.criterion_id ?? s.criterionId), s]),
  );
  const scored = [];
  for (const c of sortByOrder(criteria)) {
    const sel = byCrit.get(String(c.id));
    if (!sel) return { ok: false, error: "incomplete_rubric" };
    const levelId = sel.level_id ?? sel.levelId;
    if (!levelId) return { ok: false, error: "level_required" };
    const resolved = resolveAuthoritativeLevelPoints(criteria, c.id, levelId, sel.points);
    if (!resolved.ok) return resolved;
    scored.push({
      submission_id: submission.id,
      criterion_id: c.id,
      level_id: resolved.level.id,
      level_name: resolved.level.name,
      level_descriptor: resolved.level.descriptor,
      points: scoringMode === "qualitative" ? null : resolved.points,
      comment: sel.comment ?? null,
    });
  }

  if (scoringMode === "qualitative") {
    return {
      ok: true,
      grade: null,
      feedback: p_feedback,
      status: "graded",
      rubric_scores: scored,
      submission_id: submission.id,
      scoring_mode: "qualitative",
    };
  }

  const sum = scored.reduce((t, s) => t + Number(s.points), 0);
  return {
    ok: true,
    grade: sum,
    feedback: p_feedback,
    status: "graded",
    rubric_scores: scored,
    submission_id: submission.id,
    scoring_mode: "points",
  };
}

/** Teacher-only draft: does not mark graded; not student-visible. */
export function simulateSaveRubricDraft({
  submission,
  criteria = [],
  selections = [],
  actorIsTeacher = true,
  actorIsStudent = false,
} = {}) {
  if (actorIsStudent || !actorIsTeacher) return { ok: false, error: "forbidden" };
  if (!submission) return { ok: false, error: "not_found" };
  const draft = [];
  for (const sel of selections || []) {
    const criterionId = sel.criterion_id ?? sel.criterionId;
    const criterion = criteria.find((c) => c.id === criterionId);
    if (!criterion) return { ok: false, error: "invalid_criterion" };
    draft.push({
      submission_id: submission.id,
      criterion_id: criterionId,
      level_id: sel.level_id ?? sel.levelId ?? null,
      points: sel.points ?? null,
      comment: sel.comment ?? null,
      is_draft: true,
    });
  }
  return {
    ok: true,
    draft,
    submission_status: submission.status,
    graded: false,
  };
}

export function studentCanReadRubricEvaluation({
  submission,
  viewerUserId,
  isTeacher = false,
  isDraft = false,
} = {}) {
  if (isDraft) return false;
  if (isTeacher) return true;
  if (!submission || !viewerUserId) return false;
  if (submission.user_id !== viewerUserId) return false;
  return submission.status === "graded" || submission.status === "closed";
}

/**
 * Student-facing reconstruction of a published evaluation.
 */
export function buildStudentRubricResult({
  criteria = [],
  scores = [],
  scoringMode = "points",
  feedback = null,
  grade = null,
} = {}) {
  const byCrit = new Map((scores || []).map((s) => [s.criterion_id ?? s.criterionId, s]));
  const cards = sortByOrder(criteria).map((c) => {
    const sc = byCrit.get(c.id) || {};
    const card = {
      criterion_id: c.id,
      criterion_name: c.name,
      selected_level_name: sc.level_name ?? sc.levelName ?? null,
      descriptor: sc.level_descriptor ?? sc.levelDescriptor ?? null,
      comment: sc.comment ?? null,
    };
    if (scoringMode === "points" || isLegacyRubricCriterion(c)) {
      card.points = sc.points != null ? Number(sc.points) : null;
      if (isLegacyRubricCriterion(c)) {
        card.max_points = Number(c.max_points ?? c.maxPoints);
      }
    }
    return card;
  });
  return {
    criteria: cards,
    feedback: feedback ?? null,
    grade: scoringMode === "qualitative" ? null : grade,
    scoring_mode: scoringMode,
  };
}

/** Quantitative total from selected frozen levels (server-derived). */
export function quantitativeTotalFromLevels(criteria, selectedLevelIdsByCriterion) {
  let total = 0;
  for (const c of criteria || []) {
    const levelId = selectedLevelIdsByCriterion?.[c.id];
    const level = (c.levels || []).find((l) => l.id === levelId);
    if (!level) return null;
    const p = Number(level.points);
    if (!Number.isFinite(p)) return null;
    total += p;
  }
  return total;
}
