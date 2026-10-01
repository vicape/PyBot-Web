/**
 * Point 5 — engagement segment sync + offline pending queue.
 * Absolute totals only; retries must not double-count.
 * Privacy: stores only segment ids/timestamps/totals — never raw interaction payloads.
 */

import { getSupabase } from "../supabaseClient.js";

export const ENGAGEMENT_PENDING_STORAGE_KEY = "pybot.engagement.pending.v1";
export const ENGAGEMENT_PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ENGAGEMENT_PENDING_MAX_ROWS = 200;

function safeParse(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function getStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Minimal pending row — no event payloads. */
export function normalizePendingSegment(row) {
  if (!row) return null;
  const clientSegmentId = String(row.clientSegmentId || row.client_segment_id || "").trim();
  const activityId = String(row.activityId || row.activity_id || "").trim();
  const targetId = String(row.targetId || row.target_id || "").trim();
  if (!clientSegmentId || !activityId || !targetId) return null;
  const activeMs = Math.max(0, Math.floor(Number(row.activeMs ?? row.active_ms) || 0));
  const clientStartedAt = Number(row.clientStartedAt ?? row.client_started_at);
  if (!Number.isFinite(clientStartedAt)) return null;
  return {
    clientSegmentId,
    activityId,
    targetId,
    targetType: String(row.targetType || row.target_type || "material"),
    unitId: row.unitId ?? row.unit_id ?? null,
    lessonId: row.lessonId ?? row.lesson_id ?? null,
    activeMs,
    clientStartedAt,
    ended: Boolean(row.ended),
    updatedAt: Number(row.updatedAt) || Date.now(),
  };
}

export function readPendingEngagementSegments(storage = getStorage()) {
  if (!storage) return [];
  const rows = safeParse(storage.getItem(ENGAGEMENT_PENDING_STORAGE_KEY) || "[]")
    .map(normalizePendingSegment)
    .filter(Boolean);
  return prunePendingEngagementSegments(rows, Date.now());
}

export function prunePendingEngagementSegments(rows, now = Date.now()) {
  const cutoff = now - ENGAGEMENT_PENDING_MAX_AGE_MS;
  const kept = (rows || [])
    .map(normalizePendingSegment)
    .filter(Boolean)
    .filter((r) => (r.updatedAt || 0) >= cutoff)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  if (kept.length <= ENGAGEMENT_PENDING_MAX_ROWS) return kept;
  return kept.slice(kept.length - ENGAGEMENT_PENDING_MAX_ROWS);
}

export function writePendingEngagementSegments(rows, storage = getStorage()) {
  if (!storage) return;
  const next = prunePendingEngagementSegments(rows, Date.now());
  try {
    storage.setItem(ENGAGEMENT_PENDING_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — drop silently; never fabricate time.
  }
}

/**
 * Upsert pending absolute total for a segment (monotonic locally too).
 */
export function queuePendingEngagementSegment(payload, storage = getStorage()) {
  const row = normalizePendingSegment({ ...payload, updatedAt: Date.now() });
  if (!row) return readPendingEngagementSegments(storage);
  const existing = readPendingEngagementSegments(storage);
  const idx = existing.findIndex((r) => r.clientSegmentId === row.clientSegmentId);
  if (idx >= 0) {
    const prev = existing[idx];
    existing[idx] = {
      ...prev,
      ...row,
      activeMs: Math.max(prev.activeMs, row.activeMs),
      ended: Boolean(prev.ended || row.ended),
      updatedAt: Date.now(),
    };
  } else {
    existing.push(row);
  }
  writePendingEngagementSegments(existing, storage);
  return existing;
}

export function removePendingEngagementSegment(clientSegmentId, storage = getStorage()) {
  const id = String(clientSegmentId || "").trim();
  if (!id) return readPendingEngagementSegments(storage);
  const next = readPendingEngagementSegments(storage).filter((r) => r.clientSegmentId !== id);
  writePendingEngagementSegments(next, storage);
  return next;
}

/**
 * RPC write: absolute active_ms. Server derives user_id and enforces sanity.
 */
export async function upsertActivityEngagementSegment(
  payload,
  supabase = getSupabase(),
  storage = getStorage(),
) {
  const row = normalizePendingSegment(payload);
  if (!row) return { ok: false, error: "missing_args" };
  if (!supabase) {
    queuePendingEngagementSegment(row, storage);
    return { ok: false, error: "no_supabase", queued: true };
  }

  const { data, error } = await supabase.rpc("upsert_activity_engagement_segment", {
    p_client_segment_id: row.clientSegmentId,
    p_activity_id: row.activityId,
    p_target_id: row.targetId,
    p_target_type: row.targetType,
    p_active_ms: row.activeMs,
    p_client_started_at: new Date(row.clientStartedAt).toISOString(),
    p_ended: row.ended,
    p_unit_id: row.unitId,
    p_lesson_id: row.lessonId,
  });

  if (error) {
    queuePendingEngagementSegment(row, storage);
    return { ok: false, error: error.message || "rpc_error", queued: true };
  }

  const result = data && typeof data === "object" ? data : { ok: false, error: "bad_response" };
  if (!result.ok) {
    // Authorization / validation failures: do not keep forbidden writes forever if permanent
    if (result.error === "forbidden" || result.error === "no_session") {
      removePendingEngagementSegment(row.clientSegmentId, storage);
      return { ok: false, error: result.error, queued: false };
    }
    queuePendingEngagementSegment(row, storage);
    return { ok: false, error: result.error || "rejected", queued: true };
  }

  removePendingEngagementSegment(row.clientSegmentId, storage);
  return { ok: true, row: result.row || null };
}

export async function flushPendingEngagementSegments(supabase = getSupabase(), storage = getStorage()) {
  const pending = readPendingEngagementSegments(storage);
  const results = [];
  for (const row of pending) {
    const r = await upsertActivityEngagementSegment(row, supabase);
    results.push({ clientSegmentId: row.clientSegmentId, ...r });
  }
  return results;
}

export async function fetchActivityEngagementSegments(activityId, userId = null, supabase = getSupabase()) {
  if (!supabase || !activityId) return { rows: [], error: "missing_args" };
  const { data, error } = await supabase.rpc("get_activity_engagement_segments", {
    p_activity_id: activityId,
    p_user_id: userId,
  });
  if (error) return { rows: [], error: error.message };
  if (!data?.ok) return { rows: [], error: data?.error || "forbidden" };
  return { rows: Array.isArray(data.rows) ? data.rows : [], error: null };
}

/**
 * Apply a manager flush payload: attempt sync, queue on failure.
 */
export async function handleEngagementFlush(payload, supabase = getSupabase()) {
  return upsertActivityEngagementSegment(payload, supabase);
}
