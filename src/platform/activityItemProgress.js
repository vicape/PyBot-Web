/**
 * Point 4 — pedagogical item progress for assigned Content snapshots.
 * Scoped by activity + user + snapshot_item_id. Distinct from activity_progress (IDE/autosave).
 */
import { getSupabase } from "../supabaseClient.js";
import { listCourseAssignedContentActivities } from "./courseActivityApi.js";
import {
  deriveProcessStatus,
  submissionReachesItemProgressComplete,
} from "./submissionWorkflow.js";

export const ITEM_PROGRESS_STATUS = Object.freeze({
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
});

const STATUS_RANK = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

function sortByPosition(a, b) {
  return (a.position ?? 0) - (b.position ?? 0) || String(a.snapshotItemId || a.id || "").localeCompare(
    String(b.snapshotItemId || b.id || ""),
  );
}

/** Optional items: config.required === false. Everything else is required. */
export function isSnapshotItemRequired(item) {
  return item?.config?.required !== false;
}

/**
 * Resolve completion rule from frozen config, with type defaults when missing/none.
 */
export function resolveItemCompletionRule(item) {
  const raw = item?.config?.completion_rule;
  if (raw && raw !== "none") return raw;
  switch (item?.type) {
    case "video":
      return "video_threshold";
    case "exercise":
    case "assignment":
    case "assessment":
      return "submitted";
    case "quiz":
      return "quiz_finished";
    case "material":
    case "example":
    default:
      return "marked_complete";
  }
}

/** Video threshold in [0,1]; default 1 (player end). */
export function resolveVideoCompletionThreshold(item) {
  const t = Number(item?.config?.completion_threshold);
  if (Number.isFinite(t) && t >= 0 && t <= 1) return t;
  return 1;
}

/**
 * Flatten snapshot items with unit/lesson context.
 * Legacy snapshots without items return [].
 */
export function listSnapshotItems(snapshot) {
  if (!snapshot) return [];
  const out = [];

  const pushItems = (items, ctx) => {
    for (const raw of [...(items || [])].sort(sortByPosition)) {
      const snapshotItemId = String(raw.snapshotItemId || raw.id || "");
      if (!snapshotItemId) continue;
      out.push({
        snapshotItemId,
        sourceItemId: raw.sourceItemId || null,
        type: raw.type || "material",
        title: raw.title || "",
        position: raw.position ?? 0,
        content: raw.content && typeof raw.content === "object" ? raw.content : {},
        config: raw.config && typeof raw.config === "object" ? raw.config : {},
        unitId: ctx.unitId || null,
        unitTitle: ctx.unitTitle || "",
        lessonId: ctx.lessonId || null,
        lessonTitle: ctx.lessonTitle || "",
      });
    }
  };

  if (snapshot.sourceType === "lesson") {
    pushItems(snapshot.items, {
      unitId: snapshot.unitId || null,
      unitTitle: snapshot.unitTitle || "",
      lessonId: snapshot.sourceId,
      lessonTitle: snapshot.title || "",
    });
    return out;
  }

  if (snapshot.sourceType === "unit") {
    const lessons = [...(snapshot.lessons || [])].sort(sortByPosition);
    for (const lesson of lessons) {
      pushItems(lesson.items, {
        unitId: snapshot.sourceId,
        unitTitle: snapshot.title || "",
        lessonId: lesson.id,
        lessonTitle: lesson.title || "",
      });
    }
    return out;
  }

  if (snapshot.sourceType === "content") {
    const units = [...(snapshot.units || [])].sort(sortByPosition);
    for (const unit of units) {
      const lessons = [...(unit.lessons || [])].sort(sortByPosition);
      for (const lesson of lessons) {
        pushItems(lesson.items, {
          unitId: unit.id,
          unitTitle: unit.title || "",
          lessonId: lesson.id,
          lessonTitle: lesson.title || "",
        });
      }
    }
    return out;
  }

  return out;
}

export function snapshotHasTrackableItems(snapshot) {
  return listSnapshotItems(snapshot).length > 0;
}

export function normalizeItemStatus(status) {
  if (status === ITEM_PROGRESS_STATUS.IN_PROGRESS || status === ITEM_PROGRESS_STATUS.COMPLETED) {
    return status;
  }
  return ITEM_PROGRESS_STATUS.NOT_STARTED;
}

export function canAdvanceItemStatus(from, to) {
  const a = STATUS_RANK[normalizeItemStatus(from)] ?? 0;
  const b = STATUS_RANK[normalizeItemStatus(to)] ?? 0;
  return b >= a;
}

/**
 * Derive Item → Lesson → Unit → Content aggregates from item progress.
 * Denominator: required items only (config.required !== false).
 * Empty required set: percent 100 (vacuous), emptyRequired: true — never NaN.
 */
export function deriveProgressAggregates(snapshotItems, progressByItemId = {}) {
  const items = Array.isArray(snapshotItems) ? snapshotItems : [];
  const itemStates = {};

  for (const item of items) {
    const id = item.snapshotItemId;
    const row = progressByItemId[id];
    const status = normalizeItemStatus(row?.status);
    itemStates[id] = {
      ...item,
      status,
      required: isSnapshotItemRequired(item),
      startedAt: row?.started_at ?? row?.startedAt ?? null,
      completedAt: row?.completed_at ?? row?.completedAt ?? null,
    };
  }

  const pct = (completed, total) => {
    if (!total) return { percent: 100, completed: 0, total: 0, emptyRequired: true };
    return {
      percent: Math.round((completed / total) * 1000) / 10,
      completed,
      total,
      emptyRequired: false,
    };
  };

  const requiredItems = items.filter(isSnapshotItemRequired);
  const completedRequired = requiredItems.filter(
    (i) => itemStates[i.snapshotItemId]?.status === ITEM_PROGRESS_STATUS.COMPLETED,
  ).length;
  const contentAgg = pct(completedRequired, requiredItems.length);

  const byLesson = new Map();
  const byUnit = new Map();

  for (const item of items) {
    const lessonKey = item.lessonId || "_";
    if (!byLesson.has(lessonKey)) {
      byLesson.set(lessonKey, {
        lessonId: item.lessonId,
        lessonTitle: item.lessonTitle,
        unitId: item.unitId,
        unitTitle: item.unitTitle,
        items: [],
      });
    }
    byLesson.get(lessonKey).items.push(item);

    const unitKey = item.unitId || "_";
    if (!byUnit.has(unitKey)) {
      byUnit.set(unitKey, {
        unitId: item.unitId,
        unitTitle: item.unitTitle,
        items: [],
      });
    }
    byUnit.get(unitKey).items.push(item);
  }

  const lessons = {};
  for (const [key, group] of byLesson) {
    const req = group.items.filter(isSnapshotItemRequired);
    const done = req.filter(
      (i) => itemStates[i.snapshotItemId]?.status === ITEM_PROGRESS_STATUS.COMPLETED,
    ).length;
    lessons[key] = {
      lessonId: group.lessonId,
      lessonTitle: group.lessonTitle,
      unitId: group.unitId,
      unitTitle: group.unitTitle,
      ...pct(done, req.length),
      itemCount: group.items.length,
    };
  }

  const units = {};
  for (const [key, group] of byUnit) {
    const req = group.items.filter(isSnapshotItemRequired);
    const done = req.filter(
      (i) => itemStates[i.snapshotItemId]?.status === ITEM_PROGRESS_STATUS.COMPLETED,
    ).length;
    units[key] = {
      unitId: group.unitId,
      unitTitle: group.unitTitle,
      ...pct(done, req.length),
      itemCount: group.items.length,
    };
  }

  return {
    trackable: items.length > 0,
    content: contentAgg,
    units,
    lessons,
    items: itemStates,
  };
}

export function progressRowsToMap(rows) {
  const map = {};
  for (const row of rows || []) {
    const id = row.snapshot_item_id || row.snapshotItemId;
    if (!id) continue;
    map[id] = row;
  }
  return map;
}

/** Fetch progress rows for an activity (own or teacher-scoped via RLS/RPC). */
export async function fetchActivityItemProgress(activityId, userId = null) {
  const sb = getSupabase();
  if (!sb || !activityId) return { rows: [], map: {}, error: "missing_args" };

  const { data, error } = await sb.rpc("get_activity_item_progress", {
    p_activity_id: activityId,
    p_user_id: userId || null,
  });

  if (error) {
    // Fallback: direct select (RLS) if RPC not yet applied
    if (/get_activity_item_progress|could not find|42883/i.test(error.message)) {
      let q = sb
        .from("activity_item_progress")
        .select(
          "id, activity_id, user_id, snapshot_item_id, source_item_id, item_type, status, started_at, completed_at, updated_at, metadata",
        )
        .eq("activity_id", activityId);
      if (userId) q = q.eq("user_id", userId);
      const fb = await q;
      if (fb.error) {
        if (/activity_item_progress|does not exist/i.test(fb.error.message)) {
          return { rows: [], map: {}, error: null, missingMigration: true };
        }
        return { rows: [], map: {}, error: fb.error.message };
      }
      const rows = fb.data || [];
      return { rows, map: progressRowsToMap(rows), error: null };
    }
    return { rows: [], map: {}, error: error.message };
  }

  const payload = data && typeof data === "object" ? data : {};
  if (payload.ok === false) return { rows: [], map: {}, error: payload.error || "forbidden" };
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(data) ? data : [];
  return { rows, map: progressRowsToMap(rows), error: null };
}

/**
 * Start / update / complete item progress (forward-only via RPC).
 * @param {{ activityId: string, snapshotItemId: string, itemType: string, status: string, sourceItemId?: string|null, metadata?: object }} opts
 */
export async function upsertActivityItemProgress(opts) {
  const sb = getSupabase();
  const {
    activityId,
    snapshotItemId,
    itemType,
    status,
    sourceItemId = null,
    metadata = {},
  } = opts || {};
  if (!sb || !activityId || !snapshotItemId || !status) {
    return { ok: false, error: "missing_args" };
  }

  const { data, error } = await sb.rpc("upsert_activity_item_progress", {
    p_activity_id: activityId,
    p_snapshot_item_id: String(snapshotItemId),
    p_item_type: itemType || "material",
    p_status: status,
    p_source_item_id: sourceItemId || null,
    p_metadata: metadata && typeof metadata === "object" ? metadata : {},
  });

  if (error) {
    if (/upsert_activity_item_progress|could not find|42883|activity_item_progress/i.test(error.message)) {
      return {
        ok: false,
        error: "Falta aplicar la migración de activity_item_progress (Point 4).",
      };
    }
    return { ok: false, error: error.message };
  }
  if (data && data.ok === false) return { ok: false, error: data.error || "update_failed", row: null };
  return { ok: true, error: null, row: data?.row || data || null };
}

export async function startActivityItemProgress(opts) {
  return upsertActivityItemProgress({
    ...opts,
    status: ITEM_PROGRESS_STATUS.IN_PROGRESS,
  });
}

export async function completeActivityItemProgress(opts) {
  return upsertActivityItemProgress({
    ...opts,
    status: ITEM_PROGRESS_STATUS.COMPLETED,
  });
}

/** Teacher course overview of assignment completion (content progress, not grades). */
export async function fetchCourseContentProgressOverview(courseId) {
  const sb = getSupabase();
  if (!sb || !courseId) return { overview: null, error: "missing_args" };

  const { data, error } = await sb.rpc("get_course_content_progress_overview", {
    p_course_id: courseId,
  });

  if (error) {
    if (/get_course_content_progress_overview|could not find|42883/i.test(error.message)) {
      // Fallback via activities boundary (courseActivityApi) when RPC not yet applied.
      const listed = await listCourseAssignedContentActivities(sb, courseId);
      if (listed.error) {
        return { overview: null, error: null, missingMigration: true };
      }
      return {
        overview: {
          ok: true,
          activities: listed.rows,
          students: [],
          progress: [],
        },
        error: null,
        missingMigration: true,
      };
    }
    return { overview: null, error: error.message };
  }
  if (data && data.ok === false) return { overview: null, error: data.error || "forbidden" };
  return { overview: data, error: null };
}

/**
 * Whether a submission row's process state counts as item-progress completion.
 * Uses submissionWorkflow; grades/return remain outside progress.
 */
export function submissionCountsAsItemProgressComplete(submission) {
  if (!submission) return false;
  const processStatus = deriveProcessStatus({
    status: submission.status,
    version: submission.version,
    hasSubmission: true,
  });
  return submissionReachesItemProgressComplete(processStatus);
}

/**
 * After activity-level submission succeeds, complete snapshot items whose rule is
 * submitted / quiz_finished (minimum bridge; does not invent a second results system).
 */
export async function bridgeSubmissionToItemProgress(activityId, snapshot, submission = null) {
  const items = listSnapshotItems(snapshot);
  if (!items.length) return { ok: true, updated: 0 };

  if (submission && !submissionCountsAsItemProgressComplete(submission)) {
    return { ok: true, updated: 0 };
  }

  let updated = 0;
  for (const item of items) {
    const rule = resolveItemCompletionRule(item);
    if (rule !== "submitted" && rule !== "quiz_finished") continue;
    const { ok } = await completeActivityItemProgress({
      activityId,
      snapshotItemId: item.snapshotItemId,
      itemType: item.type,
      sourceItemId: item.sourceItemId,
      metadata: { bridge: "activity_submission" },
    });
    if (ok) updated += 1;
  }
  return { ok: true, updated };
}

/** Evaluate whether a video player event completes the item (no active-time tracking). */
export function evaluateVideoPlayerCompletion(item, { currentTime, duration, ended } = {}) {
  if (ended) return true;
  const threshold = resolveVideoCompletionThreshold(item);
  const dur = Number(duration);
  const cur = Number(currentTime);
  if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(cur)) return false;
  return cur / dur >= threshold;
}
