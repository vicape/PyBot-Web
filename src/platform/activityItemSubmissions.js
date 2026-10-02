/**
 * Embedded evaluable-item evidence for frozen assignment snapshots.
 * Identity: activity + user + snapshot_item_id (+ immutable version).
 * SQL columns: activity_id + user_id + snapshot_item_id.
 * Independent from activity-level activity_submissions (standalone exercise/task).
 *
 * Do NOT add snapshot_id/hash/version fields unless current implementation truly requires them; pedagogical version identity suficiente:
 * activity.id + immutable content_snapshot + created_at (schemaVersion = technical format only).
 * Product gaps A/B/C/D resolved — no unresolved DECISION REQUIRED.
 */

import { getSupabase } from "../supabaseClient.js";
import { completeActivityItemProgress, resolveItemCompletionRule } from "./activityItemProgress.js";

const ITEM_SUBMISSION_SELECT =
  "id, activity_id, user_id, snapshot_item_id, item_type, version, response_text, response_payload, status, earned_points, possible_points, feedback, submitted_at, graded_at, graded_by, created_at, updated_at";

export const EMBEDDED_EVIDENCE_ITEM_TYPES = Object.freeze([
  "exercise",
  "quiz",
  "assignment",
  "assessment",
]);

const EMBEDDED_SET = new Set(EMBEDDED_EVIDENCE_ITEM_TYPES);

export function isEmbeddedEvidenceItemType(type) {
  return EMBEDDED_SET.has(String(type || ""));
}

export function itemSubmissionVersionLabel(version) {
  const n = Number(version);
  if (!Number.isFinite(n) || n < 1) return null;
  return `V${n}`;
}

/**
 * Keep latest row per (user_id, snapshot_item_id).
 */
export function pickLatestItemSubmissionPerKey(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.user_id || !row?.snapshot_item_id) continue;
    const key = `${row.user_id}::${row.snapshot_item_id}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    const pv = Number(prev.version) || 0;
    const nv = Number(row.version) || 0;
    if (nv > pv) {
      map.set(key, row);
      continue;
    }
    if (nv === pv) {
      const pt = prev.submitted_at ? Date.parse(prev.submitted_at) : 0;
      const nt = row.submitted_at ? Date.parse(row.submitted_at) : 0;
      if (nt > pt) map.set(key, row);
    }
  }
  return [...map.values()];
}

/**
 * Map latest item submissions → itemScoresById for P6 resolveItemPerformance.
 * Graded with finite earned/possible → assessed; otherwise pending (never 0).
 */
export function itemScoresByIdFromSubmissions(rows = []) {
  const latest = pickLatestItemSubmissionPerKey(rows);
  const out = {};
  for (const row of latest) {
    const id = String(row.snapshot_item_id || "");
    if (!id) continue;
    const earned = row.earned_points == null ? null : Number(row.earned_points);
    const possible = row.possible_points == null ? null : Number(row.possible_points);
    const assessed =
      row.status === "graded" &&
      Number.isFinite(earned) &&
      Number.isFinite(possible) &&
      possible > 0;
    out[id] = {
      assessed,
      earned_points: assessed ? earned : null,
      possible_points: Number.isFinite(possible) && possible > 0 ? possible : null,
      status: row.status || null,
      version: row.version ?? null,
      submission_id: row.id || row.submission_id || null,
    };
  }
  return out;
}

export async function submitActivityItem(opts) {
  const sb = getSupabase();
  const {
    activityId,
    snapshotItemId,
    itemType = "exercise",
    responseText = "",
    responsePayload = {},
  } = opts || {};
  if (!sb || !activityId || !snapshotItemId) {
    return { ok: false, submission: null, error: "missing_args" };
  }

  const { data, error } = await sb.rpc("submit_activity_item", {
    p_activity_id: activityId,
    p_snapshot_item_id: String(snapshotItemId),
    p_item_type: String(itemType || "exercise"),
    p_response_text: responseText ?? "",
    p_response_payload: responsePayload && typeof responsePayload === "object" ? responsePayload : {},
  });

  if (error) {
    if (/submit_activity_item|could not find|42883/i.test(error.message)) {
      return {
        ok: false,
        submission: null,
        error: "Falta aplicar la migración 20261002014500_p7_embedded_item_evidence_and_media.sql",
      };
    }
    return { ok: false, submission: null, error: error.message };
  }
  if (!data?.ok) {
    return { ok: false, submission: null, error: data?.error || "submit_failed" };
  }

  // P4: submission marks completion only for submitted / quiz_finished rules.
  try {
    const rule = resolveItemCompletionRule({ type: itemType, config: {} });
    if (rule === "submitted" || rule === "quiz_finished") {
      await completeActivityItemProgress({
        activityId,
        snapshotItemId: String(snapshotItemId),
        itemType: String(itemType || "exercise"),
        metadata: { bridge: "activity_item_submission", version: data.version },
      });
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true, submission: data, error: null };
}

export async function gradeActivityItemSubmission(opts) {
  const sb = getSupabase();
  const { submissionId, earnedPoints, possiblePoints, feedback = null } = opts || {};
  if (!sb || !submissionId) return { ok: false, result: null, error: "missing_args" };

  const { data, error } = await sb.rpc("grade_activity_item_submission", {
    p_submission_id: submissionId,
    p_earned_points: earnedPoints == null || earnedPoints === "" ? null : Number(earnedPoints),
    p_possible_points: possiblePoints == null || possiblePoints === "" ? null : Number(possiblePoints),
    p_feedback: feedback ?? null,
  });

  if (error) {
    if (/grade_activity_item_submission|could not find|42883/i.test(error.message)) {
      return {
        ok: false,
        result: null,
        error: "Falta aplicar la migración 20261002014500_p7_embedded_item_evidence_and_media.sql",
      };
    }
    return { ok: false, result: null, error: error.message };
  }
  if (!data?.ok) return { ok: false, result: null, error: data?.error || "grade_failed" };
  return { ok: true, result: data, error: null };
}

/** Latest submission for one student + snapshot item (or null). */
export async function fetchMyItemSubmission(activityId, snapshotItemId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !snapshotItemId || !userId) {
    return { submission: null, error: "missing_args" };
  }

  const { data, error } = await sb
    .from("activity_item_submissions")
    .select(ITEM_SUBMISSION_SELECT)
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .eq("snapshot_item_id", String(snapshotItemId))
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (/activity_item_submissions|does not exist/i.test(error.message)) {
      return { submission: null, error: null, missingMigration: true };
    }
    return { submission: null, error: error.message };
  }
  return { submission: data, error: null };
}

/** All versions for one student + snapshot item (newest first). */
export async function fetchItemSubmissionHistory(activityId, snapshotItemId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !snapshotItemId || !userId) {
    return { rows: [], error: "missing_args" };
  }

  const { data, error } = await sb
    .from("activity_item_submissions")
    .select(ITEM_SUBMISSION_SELECT)
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .eq("snapshot_item_id", String(snapshotItemId))
    .order("version", { ascending: false });

  if (error) {
    if (/activity_item_submissions|does not exist/i.test(error.message)) {
      return { rows: [], error: null, missingMigration: true };
    }
    return { rows: [], error: error.message };
  }
  return { rows: data ?? [], error: null };
}

/**
 * Teacher/student: list item submissions for an activity.
 * Returns latest per (user, snapshot_item) in `rows`, full history in `allRows`.
 */
export async function fetchActivityItemSubmissions(activityId, { userId = null } = {}) {
  const sb = getSupabase();
  if (!sb || !activityId) return { rows: [], allRows: [], error: "missing_args" };

  let q = sb
    .from("activity_item_submissions")
    .select(ITEM_SUBMISSION_SELECT)
    .eq("activity_id", activityId)
    .order("version", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) {
    if (/activity_item_submissions|does not exist/i.test(error.message)) {
      return { rows: [], allRows: [], error: null, missingMigration: true };
    }
    return { rows: [], allRows: [], error: error.message };
  }
  const allRows = data ?? [];
  return { rows: pickLatestItemSubmissionPerKey(allRows), allRows, error: null };
}
