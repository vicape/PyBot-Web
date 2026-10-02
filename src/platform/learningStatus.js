/**
 * Point 6 — independent learning dimensions: Progress · Active time · Performance.
 * Pure derived/read aggregation. Does not persist percentages or invent scores.
 *
 * Progress  → Point 4 (activity_item_progress / deriveProgressAggregates)
 * Engagement → Point 5 (activity_engagement_segments / deriveEngagementAggregates)
 * Performance → factual assessed outcomes (submission grade / rubric fallback)
 *
 * Item read model (exact shape):
 *   progress: { status, required, completed }
 *   engagement: { active_ms }
 *   performance: { assessable, assessed, earned_points, possible_points, percent }
 *   (or performance null when no factual assessed result)
 *
 * Weighted performance:
 *   performance_percent = SUM(earned_points) / SUM(possible_points) * 100
 * Verifiable case: 8/10, 16/20, 30/40 → earned=54, possible=70, performance≈77.14%
 *
 * Teacher overview columns (examples):
 *   Ana Perez | 100% | 4h 12m | 65%
 *   Juan Lopez | 60% | 2h 05m | 90%
 *   Lucia Gomez | 80% | 5h 01m | —
 */

import {
  ITEM_PROGRESS_STATUS,
  deriveProgressAggregates,
  fetchCourseContentProgressOverview,
  isSnapshotItemRequired,
  listSnapshotItems,
  normalizeItemStatus,
} from "./activityItemProgress.js";
import {
  deriveEngagementAggregates,
  sumEngagementByTarget,
} from "./activityEngagement.js";
import { sumRubricPoints, rubricMaxSum } from "./submissionWorkflow.js";
import { getSupabase } from "../supabaseClient.js";
import { fetchPybotclassGradebook } from "./pybotClassApi.js";
import { itemScoresByIdFromSubmissions } from "./activityItemSubmissions.js";

/** Item types that can carry a factual assessed result when a score source exists. */
export const ASSESSABLE_ITEM_TYPES = Object.freeze([
  "quiz",
  "exercise",
  "assignment",
  "assessment",
  "task",
]);

const ASSESSABLE_SET = new Set(ASSESSABLE_ITEM_TYPES);

export function isItemAssessable(item) {
  if (!item) return false;
  if (item.config?.assessable === false) return false;
  if (item.config?.assessable === true) return true;
  return ASSESSABLE_SET.has(String(item.type || ""));
}

/**
 * Weighted performance aggregation over assessed evaluable results only.
 * Formula: performance_percent = SUM(earned_points) / SUM(possible_points) * 100
 * pending/unassessed/non-evaluable excluded from numerator and denominator.
 * Example: 8/10 + 16/20 + 30/40 → earned=54, possible=70, performance≈77.14%
 * @param {Array<{ assessed?: boolean, earned_points?: number|null, possible_points?: number|null }>} results
 */
export function aggregatePerformance(results = []) {
  let earned = 0;
  let possible = 0;
  let assessedCount = 0;

  for (const r of results || []) {
    if (!r || r.assessed !== true) continue;
    const e = Number(r.earned_points);
    const p = Number(r.possible_points);
    if (!Number.isFinite(e) || !Number.isFinite(p) || p <= 0) continue;
    earned += e;
    possible += p;
    assessedCount += 1;
  }

  if (assessedCount === 0 || possible <= 0) {
    return {
      assessable: assessedCount > 0,
      assessed: false,
      earned_points: null,
      possible_points: null,
      percent: null,
    };
  }

  // performance_percent = SUM(earned_points) / SUM(possible_points) * 100
  const percent = Math.round((earned / possible) * 10000) / 100;
  return {
    assessable: true,
    assessed: true,
    earned_points: earned,
    possible_points: possible,
    percent,
  };
}

/**
 * Resolve activity-level performance from official grade + optional rubric detail.
 * Official activity_submissions.grade / activities.max_points wins;
 * rubric scores are detail / fallback only (no double-count).
 * Qualitative / pending must not invent grade=0 or 0%; P6 may stay null/—.
 * CASE E: 4 + 3 + 5 -> 12; P6 consumes 12/max_points once.
 */
export function resolveActivityPerformance({
  maxPoints = null,
  grade = null,
  status = null,
  rubricScores = null,
  rubricCriteria = null,
} = {}) {
  const max = maxPoints != null && maxPoints !== "" ? Number(maxPoints) : null;
  const assessable = Number.isFinite(max) && max > 0;

  if (!assessable) {
    return {
      assessable: false,
      assessed: false,
      earned_points: null,
      possible_points: null,
      percent: null,
    };
  }

  if (grade != null && grade !== "") {
    const earned = Number(grade);
    if (Number.isFinite(earned)) {
      const percent = Math.round((earned / max) * 10000) / 100;
      return {
        assessable: true,
        assessed: true,
        earned_points: earned,
        possible_points: max,
        percent,
        source: "official_grade",
      };
    }
  }

  // Rubric fallback only when no official grade and scores form a complete *numeric* evaluation.
  // Qualitative / null points must never become performance 0.
  const rubricEarned = sumRubricPoints(rubricScores);
  const rubricPossible =
    rubricMaxSum(rubricCriteria) ??
    (Array.isArray(rubricScores) && rubricScores.length
      ? rubricScores.reduce((s, row) => {
          const m = Number(row?.max_points ?? row?.maxPoints);
          return Number.isFinite(m) ? s + m : s;
        }, 0)
      : null);

  if (
    rubricEarned != null &&
    Number.isFinite(rubricPossible) &&
    rubricPossible > 0 &&
    (status === "graded" || status === "closed" || rubricScores?.length)
  ) {
    // Prefer activity max_points as possible when present (no double-count with criteria).
    const possible = max;
    const percent = Math.round((rubricEarned / possible) * 10000) / 100;
    return {
      assessable: true,
      assessed: true,
      earned_points: rubricEarned,
      possible_points: possible,
      percent,
      source: "rubric_fallback",
    };
  }

  return {
    assessable: true,
    assessed: false,
    earned_points: null,
    possible_points: max,
    percent: null,
  };
}

/**
 * Per-item performance. Without a factual per-item score source, never invents one
 * and never copies an activity-level grade onto nested items.
 */
export function resolveItemPerformance(item, itemScore = null) {
  const assessable = isItemAssessable(item);
  if (!assessable) {
    return null;
  }
  if (!itemScore || itemScore.assessed !== true) {
    return {
      assessable: true,
      assessed: false,
      earned_points: null,
      possible_points:
        itemScore?.possible_points != null && Number.isFinite(Number(itemScore.possible_points))
          ? Number(itemScore.possible_points)
          : null,
      percent: null,
    };
  }
  const earned = Number(itemScore.earned_points);
  const possible = Number(itemScore.possible_points);
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) {
    return {
      assessable: true,
      assessed: false,
      earned_points: null,
      possible_points: Number.isFinite(possible) && possible > 0 ? possible : null,
      percent: null,
    };
  }
  return {
    assessable: true,
    assessed: true,
    earned_points: earned,
    possible_points: possible,
    percent: Math.round((earned / possible) * 10000) / 100,
  };
}

/**
 * Build the Point-6 item read model.
 * Shape: progress: { status, required, completed }, engagement: { active_ms },
 * performance: { assessable, assessed, earned_points, possible_points, percent } (or null).
 */
export function buildItemLearningStatus(
  item,
  { progressRow = null, activeMs = 0, itemScore = null, engagementAvailable = true } = {},
) {
  const status = normalizeItemStatus(progressRow?.status);
  const required = isSnapshotItemRequired(item);
  return {
    snapshotItemId: item.snapshotItemId,
    type: item.type,
    title: item.title || "",
    unitId: item.unitId ?? null,
    lessonId: item.lessonId ?? null,
    // progress: { status, required, completed }
    progress: {
      status,
      required,
      completed: status === ITEM_PROGRESS_STATUS.COMPLETED,
    },
    // engagement: { active_ms } (+ available:false when RPC/overview missing)
    engagement: buildEngagementPayload(activeMs, { available: engagementAvailable }),
    // performance: { assessable, assessed, earned_points, possible_points, percent }
    performance: resolveItemPerformance(item, itemScore),
  };
}

/**
 * Derive item → lesson → unit → content learning status.
 * Activity-level assessed result is attached once at content scope (never copied to items).
 */
export function deriveLearningStatusAggregates({
  snapshot = null,
  snapshotItems = null,
  progressByItemId = {},
  engagementSegments = [],
  itemScoresById = {},
  activityPerformance = null,
  engagementAvailable = true,
} = {}) {
  const items = snapshotItems || listSnapshotItems(snapshot);
  const progressAgg = deriveProgressAggregates(items, progressByItemId);
  const engagementAgg = deriveEngagementAggregates(snapshot || { sourceType: "content", units: [] }, engagementSegments);
  const byTarget = sumEngagementByTarget(engagementSegments);

  const itemStatuses = {};
  const performanceLeaves = [];

  for (const item of items) {
    const id = item.snapshotItemId;
    const activeMs = byTarget[id]?.activeMs ?? 0;
    const status = buildItemLearningStatus(item, {
      progressRow: progressByItemId[id],
      activeMs,
      itemScore: itemScoresById[id] || null,
      engagementAvailable,
    });
    itemStatuses[id] = status;
    if (status.performance?.assessed) {
      performanceLeaves.push(status.performance);
    }
  }

  // Activity-level factual grade counts once at content scope for standalone
  // Activities only — never copied onto nested items, never double-counted with
  // factual embedded-item scores.
  const hasAssessableNested = items.some((it) => isItemAssessable(it));
  if (activityPerformance?.assessed && !hasAssessableNested) {
    performanceLeaves.push(activityPerformance);
  }

  let contentPerformance = aggregatePerformance(performanceLeaves);
  // Assessable activity without assessed results → Pendiente (never 0).
  if (!contentPerformance.assessed) {
    if (hasAssessableNested) {
      const anyAssessablePending = items.some((it) => isItemAssessable(it));
      if (anyAssessablePending) {
        contentPerformance = {
          assessable: true,
          assessed: false,
          earned_points: null,
          possible_points: null,
          percent: null,
        };
      }
    } else if (activityPerformance?.assessable && !activityPerformance.assessed) {
      contentPerformance = {
        assessable: true,
        assessed: false,
        earned_points: null,
        possible_points: activityPerformance.possible_points ?? null,
        percent: null,
      };
    }
  }

  const lessons = {};
  const units = {};

  for (const [key, lessonProg] of Object.entries(progressAgg.lessons || {})) {
    const lessonItems = items.filter((i) => String(i.lessonId || "_") === String(key));
    const lessonPerf = [];
    for (const it of lessonItems) {
      const p = itemStatuses[it.snapshotItemId]?.performance;
      if (p?.assessed) lessonPerf.push(p);
    }
    const eng = engagementAgg.lessons?.[key] || engagementAgg.lessons?.[lessonProg.lessonId];
    lessons[key] = {
      lessonId: lessonProg.lessonId,
      lessonTitle: lessonProg.lessonTitle,
      unitId: lessonProg.unitId,
      unitTitle: lessonProg.unitTitle,
      progress: {
        status: null,
        required: !lessonProg.emptyRequired,
        completed: lessonProg.completed,
        total: lessonProg.total,
        percent: lessonProg.emptyRequired ? null : lessonProg.percent,
        emptyRequired: lessonProg.emptyRequired,
      },
      engagement: buildEngagementPayload(eng?.activeMs ?? 0, { available: engagementAvailable }),
      performance: aggregatePerformance(lessonPerf),
    };
  }

  for (const [key, unitProg] of Object.entries(progressAgg.units || {})) {
    const unitItems = items.filter((i) => String(i.unitId || "_") === String(key));
    const unitPerf = [];
    for (const it of unitItems) {
      const p = itemStatuses[it.snapshotItemId]?.performance;
      if (p?.assessed) unitPerf.push(p);
    }
    const eng = engagementAgg.units?.[key] || engagementAgg.units?.[unitProg.unitId];
    units[key] = {
      unitId: unitProg.unitId,
      unitTitle: unitProg.unitTitle,
      progress: {
        status: null,
        required: !unitProg.emptyRequired,
        completed: unitProg.completed,
        total: unitProg.total,
        percent: unitProg.emptyRequired ? null : unitProg.percent,
        emptyRequired: unitProg.emptyRequired,
      },
      engagement: buildEngagementPayload(eng?.activeMs ?? 0, { available: engagementAvailable }),
      performance: aggregatePerformance(unitPerf),
    };
  }

  return {
    trackable: progressAgg.trackable,
    content: {
      progress: {
        status: null,
        required: !progressAgg.content.emptyRequired,
        completed: progressAgg.content.completed,
        total: progressAgg.content.total,
        percent: progressAgg.content.emptyRequired ? null : progressAgg.content.percent,
        emptyRequired: progressAgg.content.emptyRequired,
      },
      engagement: buildEngagementPayload(engagementAgg.content?.activeMs ?? 0, {
        available: engagementAvailable,
      }),
      performance: contentPerformance,
      /** Activity-scoped performance (grade/max_points), independent of nested items. */
      activityPerformance: activityPerformance || null,
    },
    units,
    lessons,
    items: itemStatuses,
    /** Raw Point-4 / Point-5 aggregates preserved for existing drill-down consumers. */
    _progress: progressAgg,
    _engagement: engagementAgg,
  };
}

/** Format active_ms as "4h 12m" / "2h 05m" / "8m" / "0m". */
export function formatActiveTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const totalMinutes = Math.floor(total / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

/**
 * Engagement display: unavailable → "—"; available factual zero → "0m".
 * Treat missing/undefined available as available (normal RPC-present path).
 */
export function formatEngagementDisplay(engagement) {
  if (!engagement || engagement.available === false || engagement.unavailable === true) {
    return "—";
  }
  return formatActiveTime(engagement.active_ms);
}

/** Build engagement payload; unavailable must not be coerced to 0m. */
export function buildEngagementPayload(activeMs, { available = true } = {}) {
  if (available === false) {
    return { active_ms: null, available: false };
  }
  return { active_ms: Math.max(0, Math.floor(Number(activeMs) || 0)) };
}

/**
 * Display helper: assessed % · Pendiente (assessable unassessed) · — (non-evaluable / null).
 */
export function formatPerformanceDisplay(performance) {
  if (performance == null) return "—";
  if (performance.assessed === true && performance.percent != null) {
    const n = Number(performance.percent);
    if (!Number.isFinite(n)) return "—";
    // Keep one decimal when needed (77.14), drop trailing .0
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
  }
  if (performance.assessable === true && performance.assessed !== true) {
    return "Pendiente";
  }
  return "—";
}

export function formatProgressDisplay(progress) {
  if (!progress || progress.emptyRequired) return "—";
  if (progress.percent == null) return "—";
  return `${progress.percent}%`;
}

/**
 * Teacher course overview: reuse P4 overview + gradebook + engagement from extended RPC
 * (or client fallbacks when migration not yet applied).
 */
export async function fetchCourseLearningStatusOverview(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { overview: null, error: "missing_args" };

  const { data, error } = await sb.rpc("get_course_learning_status_overview", {
    p_course_id: courseId,
  });

  if (!error && data) {
    if (data.ok === false) return { overview: null, error: data.error || "forbidden" };
    return { overview: data, error: null };
  }

  if (error && !/get_course_learning_status_overview|could not find|42883/i.test(error.message)) {
    return { overview: null, error: error.message };
  }

  // Fallback: compose from existing P4 overview + gradebook (engagement empty until migration).
  const [progressRes, gradebookRes] = await Promise.all([
    fetchCourseContentProgressOverview(courseId),
    fetchPybotclassGradebook(courseId),
  ]);

  if (progressRes.error && !progressRes.missingMigration) {
    return { overview: null, error: progressRes.error };
  }

  const base = progressRes.overview || { activities: [], students: [], progress: [] };
  const gb = gradebookRes.gradebook;

  return {
    overview: {
      ok: true,
      course_id: courseId,
      activities: (base.activities || []).map((a) => ({
        ...a,
        max_points: a.max_points ?? gb?.activities?.find((x) => x.id === a.id)?.max_points ?? null,
      })),
      students: base.students || gb?.students || [],
      progress: base.progress || [],
      engagement: [],
      engagementUnavailable: true,
      missingLearningStatusRpc: true,
      submissions: (gb?.grades || []).map((g) => ({
        user_id: g.user_id,
        activity_id: g.activity_id,
        grade: g.grade,
        status: g.status,
        max_points: gb?.activities?.find((x) => x.id === g.activity_id)?.max_points ?? null,
      })),
    },
    error: null,
    missingMigration: Boolean(progressRes.missingMigration),
  };
}

/**
 * Build per-student summaries for one activity from a learning-status overview payload.
 */
export function buildStudentActivityLearningSummaries({
  activity,
  students = [],
  progressRows = [],
  engagementRows = [],
  submissionRows = [],
  itemSubmissionRows = [],
  engagementAvailable = true,
} = {}) {
  if (!activity) return [];
  const items = listSnapshotItems(activity.content_snapshot);
  const actId = activity.id;

  return (students || []).map((student) => {
    const uid = student.user_id;
    const progressByItemId = {};
    for (const row of progressRows || []) {
      if (row.activity_id !== actId || row.user_id !== uid) continue;
      const id = row.snapshot_item_id || row.snapshotItemId;
      if (id) progressByItemId[id] = row;
    }

    const segments = (engagementRows || []).filter(
      (s) => s.activity_id === actId && s.user_id === uid,
    );

    const sub = (submissionRows || []).find(
      (s) => s.activity_id === actId && s.user_id === uid,
    );
    const activityPerformance = resolveActivityPerformance({
      maxPoints: sub?.max_points ?? activity.max_points,
      grade: sub?.grade,
      status: sub?.status,
      rubricScores: sub?.rubric_scores || sub?.rubricScores || null,
      rubricCriteria: sub?.rubric_criteria || sub?.rubricCriteria || null,
    });

    const studentItemSubs = (itemSubmissionRows || []).filter(
      (s) => s.activity_id === actId && s.user_id === uid,
    );
    const itemScoresById = itemScoresByIdFromSubmissions(studentItemSubs);

    const learning = deriveLearningStatusAggregates({
      snapshot: activity.content_snapshot,
      snapshotItems: items,
      progressByItemId,
      engagementSegments: segments,
      itemScoresById,
      activityPerformance: activityPerformance.assessable ? activityPerformance : null,
      engagementAvailable,
    });

    return { student, learning, activityPerformance, itemScoresById };
  });
}
