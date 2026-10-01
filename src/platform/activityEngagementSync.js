/**
 * Point 5 — engagement segment sync + offline pending queue.
 * Absolute totals only; retries must not double-count.
 * Privacy: stores only segment ids/timestamps/totals — never raw interaction payloads.
 * Local userId namespaces the pending cache only — never sent as trusted write identity.
 */

import { getSupabase } from "../supabaseClient.js";

/** Legacy unscoped queue — never reassigned; discard/ignore only. */
export const ENGAGEMENT_PENDING_STORAGE_KEY = "pybot.engagement.pending.v1";
export const ENGAGEMENT_PENDING_STORAGE_KEY_PREFIX_V2 = "pybot.engagement.pending.v2.";
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

/**
 * Local-cache namespace only. Never trust this id for server writes (auth.uid() is authoritative).
 */
export function pendingEngagementStorageKeyForUser(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `${ENGAGEMENT_PENDING_STORAGE_KEY_PREFIX_V2}${id}`;
}

/**
 * Legacy v1 unscoped queue must not be claimed by whichever user logs in next.
 */
export function discardLegacyUnscopedPendingEngagement(storage = getStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(ENGAGEMENT_PENDING_STORAGE_KEY);
  } catch {
    // ignore
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

export function readPendingEngagementSegments(storage = getStorage(), localUserId = null) {
  if (!storage) return [];
  discardLegacyUnscopedPendingEngagement(storage);
  const key = pendingEngagementStorageKeyForUser(localUserId);
  if (!key) return [];
  const rows = safeParse(storage.getItem(key) || "[]")
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

export function writePendingEngagementSegments(rows, storage = getStorage(), localUserId = null) {
  if (!storage) return;
  discardLegacyUnscopedPendingEngagement(storage);
  const key = pendingEngagementStorageKeyForUser(localUserId);
  if (!key) return;
  const next = prunePendingEngagementSegments(rows, Date.now());
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota / private mode — drop silently; never fabricate time.
  }
}

/**
 * Upsert pending absolute total for a segment (monotonic locally too).
 * localUserId is cache namespace only — never a write identity.
 */
export function queuePendingEngagementSegment(payload, storage = getStorage(), localUserId = null) {
  const row = normalizePendingSegment({ ...payload, updatedAt: Date.now() });
  if (!row) return readPendingEngagementSegments(storage, localUserId);
  if (!pendingEngagementStorageKeyForUser(localUserId)) {
    return [];
  }
  const existing = readPendingEngagementSegments(storage, localUserId);
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
  writePendingEngagementSegments(existing, storage, localUserId);
  return existing;
}

export function removePendingEngagementSegment(
  clientSegmentId,
  storage = getStorage(),
  localUserId = null,
  { onlyIfAckMsAtLeast = null } = {},
) {
  const id = String(clientSegmentId || "").trim();
  if (!id) return readPendingEngagementSegments(storage, localUserId);
  const pending = readPendingEngagementSegments(storage, localUserId);
  const idx = pending.findIndex((r) => r.clientSegmentId === id);
  if (idx < 0) return pending;

  if (onlyIfAckMsAtLeast != null) {
    const ackMs = Math.max(0, Math.floor(Number(onlyIfAckMsAtLeast) || 0));
    const current = pending[idx];
    // Stale/out-of-order ACK must not erase a newer pending absolute total.
    if (ackMs < current.activeMs) {
      return pending;
    }
  }

  const next = pending.filter((r) => r.clientSegmentId !== id);
  writePendingEngagementSegments(next, storage, localUserId);
  return next;
}

/**
 * RPC write: absolute active_ms. Server derives user_id and enforces sanity.
 * Write-ahead: LOCAL ABSOLUTE TOTAL → persist pending → RPC → ACK ≥ pending to clear.
 */
export async function upsertActivityEngagementSegment(
  payload,
  supabase = getSupabase(),
  storage = getStorage(),
  localUserId = null,
) {
  const row = normalizePendingSegment(payload);
  if (!row) return { ok: false, error: "missing_args" };

  // WRITE-AHEAD: persist absolute total locally BEFORE attempting RPC.
  queuePendingEngagementSegment(row, storage, localUserId);

  if (!supabase) {
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
    return { ok: false, error: error.message || "rpc_error", queued: true };
  }

  const result = data && typeof data === "object" ? data : { ok: false, error: "bad_response" };
  if (!result.ok) {
    // Authorization / permanent validation failures: do not keep forbidden writes forever
    if (
      result.error === "forbidden" ||
      result.error === "no_session" ||
      result.error === "identity_mismatch"
    ) {
      removePendingEngagementSegment(row.clientSegmentId, storage, localUserId);
      return { ok: false, error: result.error, queued: false };
    }
    return { ok: false, error: result.error || "rejected", queued: true };
  }

  const ackMs = Number(result.row?.active_ms ?? result.active_ms);
  removePendingEngagementSegment(row.clientSegmentId, storage, localUserId, {
    onlyIfAckMsAtLeast: Number.isFinite(ackMs) ? ackMs : row.activeMs,
  });
  return { ok: true, row: result.row || null };
}

export async function flushPendingEngagementSegments(
  supabase = getSupabase(),
  storage = getStorage(),
  localUserId = null,
) {
  discardLegacyUnscopedPendingEngagement(storage);
  const pending = readPendingEngagementSegments(storage, localUserId);
  const results = [];
  for (const row of pending) {
    const r = await upsertActivityEngagementSegment(row, supabase, storage, localUserId);
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
 * Apply a manager flush payload: write-ahead then attempt sync.
 * localUserId is cache namespace only.
 */
export async function handleEngagementFlush(
  payload,
  supabase = getSupabase(),
  storage = getStorage(),
  localUserId = null,
) {
  return upsertActivityEngagementSegment(payload, supabase, storage, localUserId);
}
