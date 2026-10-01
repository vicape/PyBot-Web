/**
 * Point 5 — pedagogical active-time engagement for assigned Content.
 * Separate from Point 4 item progress/completion. Wall-clock active segments only.
 */

export const ENGAGEMENT_INACTIVITY_MS = 90_000;
export const ENGAGEMENT_SYNC_INTERVAL_MS = 15_000;

export const ENGAGEMENT_TARGET_KIND = Object.freeze({
  SNAPSHOT_ITEM: "snapshot_item",
  LESSON_DOCUMENT: "lesson_document",
  ASSIGNED_IDE: "assigned_ide",
});

export const LESSON_DOC_TARGET_PREFIX = "lesson-doc:";
export const IDE_TARGET_PREFIX = "activity-ide:";

/** Priority: higher wins; only one target accumulates at a time. */
export const ENGAGEMENT_PRIORITY = Object.freeze({
  VIDEO_PLAYING: 3,
  INTERACTED_ELEMENT: 2,
  LESSON_DOCUMENT: 1,
});

export function lessonDocumentTargetId(lessonId) {
  return `${LESSON_DOC_TARGET_PREFIX}${String(lessonId || "").trim()}`;
}

export function assignedIdeTargetId(activityId) {
  return `${IDE_TARGET_PREFIX}${String(activityId || "").trim()}`;
}

export function isLessonDocumentTargetId(targetId) {
  return String(targetId || "").startsWith(LESSON_DOC_TARGET_PREFIX);
}

export function isAssignedIdeTargetId(targetId) {
  return String(targetId || "").startsWith(IDE_TARGET_PREFIX);
}

function defaultNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function defaultWallNow() {
  return Date.now();
}

function defaultSegmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  return a.targetId === b.targetId;
}

function cloneTarget(t) {
  if (!t) return null;
  return {
    targetId: String(t.targetId),
    targetType: String(t.targetType || "material"),
    kind: t.kind || ENGAGEMENT_TARGET_KIND.SNAPSHOT_ITEM,
    unitId: t.unitId != null ? String(t.unitId) : null,
    lessonId: t.lessonId != null ? String(t.lessonId) : null,
    priority: t.priority ?? ENGAGEMENT_PRIORITY.INTERACTED_ELEMENT,
  };
}

/**
 * Controllable engagement state machine.
 * Uses monotonic `now()` for elapsed; wall clock only at persistence boundaries.
 */
export function createEngagementManager(options = {}) {
  const activityId = options.activityId ? String(options.activityId) : null;
  const nowFn = options.now || defaultNow;
  const wallNowFn = options.wallNow || defaultWallNow;
  const createSegmentId = options.createSegmentId || defaultSegmentId;
  const inactivityMs = options.inactivityMs ?? ENGAGEMENT_INACTIVITY_MS;
  const syncIntervalMs = options.syncIntervalMs ?? ENGAGEMENT_SYNC_INTERVAL_MS;
  const onFlush = typeof options.onFlush === "function" ? options.onFlush : null;

  let documentVisible = true;
  let currentTarget = null;
  let lessonDocTarget = null;
  let videoPlaying = false;
  let accumulating = false;
  let idlePaused = false;
  let lastInteractionAt = null;
  let segment = null; // { clientSegmentId, startedMono, startedWall, activeMs, lastSyncMono, ended }
  let lastTickAt = nowFn();
  let destroyed = false;

  function emitFlush(reason, { ended = false } = {}) {
    if (!onFlush || !segment || !activityId || !currentTarget) return;
    const payload = {
      clientSegmentId: segment.clientSegmentId,
      activityId,
      targetId: currentTarget.targetId,
      targetType: currentTarget.targetType,
      unitId: currentTarget.unitId,
      lessonId: currentTarget.lessonId,
      activeMs: Math.max(0, Math.floor(segment.activeMs)),
      clientStartedAt: segment.startedWall,
      ended: Boolean(ended || segment.ended),
      reason: reason || "sync",
    };
    onFlush(payload);
  }

  function endSegment(reason) {
    if (!segment) return;
    segment.ended = true;
    emitFlush(reason, { ended: true });
    segment = null;
    accumulating = false;
  }

  function startSegment() {
    if (!activityId || !currentTarget || !documentVisible) return;
    if (currentTarget.targetType === "video" && !videoPlaying) return;

    const t = nowFn();
    segment = {
      clientSegmentId: createSegmentId(),
      startedMono: t,
      startedWall: wallNowFn(),
      activeMs: 0,
      lastSyncMono: t,
      ended: false,
    };
    accumulating = true;
    idlePaused = false;
    lastInteractionAt = t;
    lastTickAt = t;
  }

  function pauseAccumulating(reason) {
    if (!accumulating && !segment) return;
    tickInternal();
    if (segment) endSegment(reason);
    accumulating = false;
  }

  function tickInternal() {
    const t = nowFn();
    const dt = Math.max(0, t - lastTickAt);
    lastTickAt = t;
    if (!accumulating || !segment || !documentVisible) return;

    if (currentTarget?.targetType === "video") {
      if (!videoPlaying) return;
      segment.activeMs += dt;
    } else {
      if (lastInteractionAt != null && t - lastInteractionAt >= inactivityMs) {
        idlePaused = true;
        accumulating = false;
        endSegment("idle");
        return;
      }
      segment.activeMs += dt;
    }

    if (segment && t - segment.lastSyncMono >= syncIntervalMs) {
      segment.lastSyncMono = t;
      emitFlush("periodic", { ended: false });
    }
  }

  function maybeResumeAfterInteraction() {
    if (destroyed || !documentVisible || !currentTarget) return;
    if (accumulating) return;
    if (currentTarget.targetType === "video") {
      if (videoPlaying) startSegment();
      return;
    }
    startSegment();
  }

  function setDocumentVisible(visible) {
    if (destroyed) return;
    tickInternal();
    const next = Boolean(visible);
    if (documentVisible === next) return;
    documentVisible = next;
    if (!documentVisible) {
      pauseAccumulating("hidden");
      return;
    }
    // Visible again does NOT resume non-video by itself.
    if (currentTarget?.targetType === "video" && videoPlaying) {
      startSegment();
    }
  }

  function setTarget(target, { startIfEligible = true } = {}) {
    if (destroyed) return;
    tickInternal();
    const next = cloneTarget(target);
    if (!next?.targetId) {
      pauseAccumulating("clear");
      currentTarget = null;
      videoPlaying = false;
      return;
    }

    if (sameTarget(currentTarget, next) && currentTarget.kind === next.kind) {
      // Update metadata/priority without restarting if same id
      currentTarget = { ...currentTarget, ...next };
      return;
    }

    pauseAccumulating("target_change");
    currentTarget = next;
    videoPlaying = false;
    idlePaused = false;

    if (next.kind === ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT) {
      lessonDocTarget = next;
    }

    if (!startIfEligible || !documentVisible) return;

    if (next.targetType === "video") {
      // Video waits for play
      return;
    }
    startSegment();
  }

  function setLessonDocumentTarget(target) {
    const next = cloneTarget(target);
    if (next) {
      next.kind = ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT;
      next.priority = ENGAGEMENT_PRIORITY.LESSON_DOCUMENT;
      next.targetType = next.targetType || "material";
      lessonDocTarget = next;
    } else {
      lessonDocTarget = null;
    }

    // Only adopt lesson doc if nothing higher-priority is active
    if (!currentTarget || currentTarget.kind === ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT) {
      if (next) setTarget(next, { startIfEligible: true });
      else setTarget(null);
    }
  }

  function noteInteraction() {
    if (destroyed) return;
    tickInternal();
    const t = nowFn();
    lastInteractionAt = t;
    if (!documentVisible) return;

    if (idlePaused && currentTarget && currentTarget.targetType !== "video") {
      idlePaused = false;
      startSegment();
      return;
    }

    if (!accumulating && currentTarget && currentTarget.targetType !== "video") {
      maybeResumeAfterInteraction();
    }
  }

  function setVideoPlaying(playing) {
    if (destroyed) return;
    tickInternal();
    const next = Boolean(playing);
    if (videoPlaying === next) return;
    videoPlaying = next;

    if (!currentTarget || currentTarget.targetType !== "video") return;

    if (videoPlaying && documentVisible) {
      // Video wins: restart segment on this video target
      if (segment) endSegment("video_reprioritize");
      startSegment();
      return;
    }

    // pause / waiting / seek / hidden — stop video accumulation; keep video target
    // so a later play can resume without losing priority over the lesson doc.
    pauseAccumulating("video_pause");
  }

  function setVideoMediaState(state = {}) {
    if (destroyed) return;
    if (state.ended) {
      tickInternal();
      videoPlaying = false;
      pauseAccumulating("video_ended");
      if (lessonDocTarget) {
        currentTarget = cloneTarget(lessonDocTarget);
        idlePaused = true;
        accumulating = false;
      }
      return;
    }
    const playing =
      Boolean(state.playing) && !state.waiting && !state.seeking && !state.stalled;
    setVideoPlaying(playing);
  }

  function fallBackToLessonDocument() {
    if (!lessonDocTarget) {
      setTarget(null);
      return;
    }
    if (currentTarget && currentTarget.kind === ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT) return;
    setTarget(lessonDocTarget, { startIfEligible: false });
    // Require interaction to resume non-video after leaving a higher-priority target
    idlePaused = true;
    accumulating = false;
  }

  function leaveCurrentTarget() {
    if (destroyed) return;
    tickInternal();
    pauseAccumulating("leave");
    const leaving = currentTarget;
    currentTarget = null;
    videoPlaying = false;
    if (leaving?.kind !== ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT && lessonDocTarget) {
      fallBackToLessonDocument();
    }
  }

  function tick() {
    if (destroyed) return getSnapshot();
    tickInternal();
    return getSnapshot();
  }

  function flush(reason = "manual") {
    if (destroyed) return;
    tickInternal();
    if (segment) {
      emitFlush(reason, { ended: !accumulating });
      if (!accumulating) {
        segment = null;
      } else {
        segment.lastSyncMono = nowFn();
      }
    }
  }

  function destroy() {
    if (destroyed) return;
    tickInternal();
    pauseAccumulating("destroy");
    destroyed = true;
    currentTarget = null;
    lessonDocTarget = null;
  }

  function getSnapshot() {
    return {
      activityId,
      documentVisible,
      accumulating,
      idlePaused,
      videoPlaying,
      currentTarget: cloneTarget(currentTarget),
      lessonDocTarget: cloneTarget(lessonDocTarget),
      activeMs: segment ? Math.floor(segment.activeMs) : 0,
      clientSegmentId: segment?.clientSegmentId || null,
      segmentEnded: segment ? Boolean(segment.ended) : true,
      destroyed,
    };
  }

  return {
    setDocumentVisible,
    setTarget,
    setLessonDocumentTarget,
    noteInteraction,
    setVideoPlaying,
    setVideoMediaState,
    leaveCurrentTarget,
    tick,
    flush,
    destroy,
    getSnapshot,
    /** @internal test helper */
    _forceIdleCheck() {
      tickInternal();
    },
  };
}

/**
 * Sum segment active_ms by target (absolute stored totals already de-duplicated server-side).
 * When multiple segments share a target, sum them (segments are contiguous non-overlapping periods).
 */
export function sumEngagementByTarget(segments = []) {
  const byTarget = Object.create(null);
  for (const seg of segments || []) {
    const id = seg.target_id || seg.targetId;
    if (!id) continue;
    const ms = Math.max(0, Number(seg.active_ms ?? seg.activeMs) || 0);
    if (!byTarget[id]) {
      byTarget[id] = {
        targetId: id,
        targetType: seg.target_type || seg.targetType || "material",
        unitId: seg.unit_id ?? seg.unitId ?? null,
        lessonId: seg.lesson_id ?? seg.lessonId ?? null,
        activeMs: 0,
      };
    }
    byTarget[id].activeMs += ms;
    if (seg.unit_id || seg.unitId) byTarget[id].unitId = seg.unit_id ?? seg.unitId;
    if (seg.lesson_id || seg.lessonId) byTarget[id].lessonId = seg.lesson_id ?? seg.lessonId;
    if (seg.target_type || seg.targetType) {
      byTarget[id].targetType = seg.target_type || seg.targetType;
    }
  }
  return byTarget;
}

/**
 * Deterministic aggregation: element → lesson → unit → content.
 * Parent totals are derived from child/target totals (no stored parent truth).
 * Lesson includes lesson-document targets + item targets for that lesson.
 */
export function deriveEngagementAggregates(snapshot, segments = []) {
  const byTarget = sumEngagementByTarget(segments);
  const items = [];

  // Collect known item context from snapshot when available
  const pushItemCtx = (raw, ctx) => {
    const id = String(raw.snapshotItemId || raw.id || "");
    if (!id) return;
    items.push({
      targetId: id,
      targetType: raw.type || "material",
      unitId: ctx.unitId || null,
      lessonId: ctx.lessonId || null,
    });
  };

  if (snapshot?.sourceType === "lesson") {
    for (const raw of snapshot.items || []) {
      pushItemCtx(raw, {
        unitId: snapshot.unitId || null,
        lessonId: snapshot.sourceId,
      });
    }
  } else if (snapshot?.sourceType === "unit") {
    for (const lesson of snapshot.lessons || []) {
      for (const raw of lesson.items || []) {
        pushItemCtx(raw, { unitId: snapshot.sourceId, lessonId: lesson.id });
      }
    }
  } else if (snapshot?.sourceType === "content") {
    for (const unit of snapshot.units || []) {
      for (const lesson of unit.lessons || []) {
        for (const raw of lesson.items || []) {
          pushItemCtx(raw, { unitId: unit.id, lessonId: lesson.id });
        }
      }
    }
  } else if (snapshot?.sourceType === "exercise" || snapshot?.sourceType === "task") {
    // Standalone coding assignment: single synthetic target may be IDE or source
    items.push({
      targetId: snapshot.sourceId ? String(snapshot.sourceId) : null,
      targetType: snapshot.sourceType,
      unitId: null,
      lessonId: snapshot.lessonId || snapshot.sourceId || null,
    });
  }

  // Enrich byTarget with snapshot context
  for (const item of items) {
    if (!item.targetId) continue;
    if (byTarget[item.targetId]) {
      byTarget[item.targetId].unitId = byTarget[item.targetId].unitId || item.unitId;
      byTarget[item.targetId].lessonId = byTarget[item.targetId].lessonId || item.lessonId;
      byTarget[item.targetId].targetType = byTarget[item.targetId].targetType || item.targetType;
    }
  }

  const lessons = Object.create(null);
  const units = Object.create(null);
  let contentMs = 0;

  const ensureLesson = (lessonId, unitId) => {
    const key = lessonId || "_";
    if (!lessons[key]) {
      lessons[key] = { lessonId: lessonId || null, unitId: unitId || null, activeMs: 0, targets: {} };
    }
    return lessons[key];
  };

  const ensureUnit = (unitId) => {
    const key = unitId || "_";
    if (!units[key]) {
      units[key] = { unitId: unitId || null, activeMs: 0, lessons: {} };
    }
    return units[key];
  };

  for (const target of Object.values(byTarget)) {
    let lessonId = target.lessonId;
    let unitId = target.unitId;

    if (isLessonDocumentTargetId(target.targetId)) {
      lessonId = lessonId || target.targetId.slice(LESSON_DOC_TARGET_PREFIX.length);
    }

    const lesson = ensureLesson(lessonId, unitId);
    lesson.targets[target.targetId] = target.activeMs;
    lesson.activeMs += target.activeMs;
    if (unitId && !lesson.unitId) lesson.unitId = unitId;

    const unit = ensureUnit(lesson.unitId || unitId);
    // Lesson totals roll into unit once — tracked via lessons map below
    contentMs += target.activeMs;
  }

  // Rebuild unit totals as sum of lesson totals (no double-count)
  for (const unit of Object.values(units)) {
    unit.activeMs = 0;
    unit.lessons = {};
  }
  for (const [lessonKey, lesson] of Object.entries(lessons)) {
    const unit = ensureUnit(lesson.unitId);
    unit.lessons[lessonKey] = lesson.activeMs;
    unit.activeMs += lesson.activeMs;
  }

  // Content total = sum of units (equivalent to sum of all targets when hierarchy covers all)
  let fromUnits = 0;
  for (const unit of Object.values(units)) fromUnits += unit.activeMs;
  // Prefer unit sum when hierarchy present; otherwise raw target sum
  const contentActiveMs = Object.keys(units).length ? fromUnits : contentMs;

  return {
    targets: byTarget,
    lessons,
    units,
    content: { activeMs: contentActiveMs },
  };
}

/**
 * Build a deterministic engagement target for an assigned IDE session.
 */
export function resolveAssignedIdeEngagementTarget(activityId, activity = null, snapshot = null) {
  if (!activityId) return null;
  const snap = snapshot || activity?.content_snapshot || null;
  const kind = activity?.activity_kind || snap?.sourceType || "exercise";
  const targetType = kind === "task" || snap?.sourceType === "task" ? "task" : "exercise";
  return {
    targetId: assignedIdeTargetId(activityId),
    targetType,
    kind: ENGAGEMENT_TARGET_KIND.ASSIGNED_IDE,
    unitId: null,
    lessonId: snap?.lessonId || snap?.sourceId || null,
    priority: ENGAGEMENT_PRIORITY.INTERACTED_ELEMENT,
  };
}

/**
 * Build lesson-document engagement target from frozen lesson identity.
 */
export function resolveLessonDocumentEngagementTarget(lesson) {
  if (!lesson?.id) return null;
  return {
    targetId: lessonDocumentTargetId(lesson.id),
    targetType: "material",
    kind: ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT,
    unitId: lesson.unitId != null ? String(lesson.unitId) : null,
    lessonId: String(lesson.id),
    priority: ENGAGEMENT_PRIORITY.LESSON_DOCUMENT,
  };
}

/**
 * Build snapshot-item engagement target.
 */
export function resolveSnapshotItemEngagementTarget(item) {
  if (!item?.snapshotItemId) return null;
  return {
    targetId: String(item.snapshotItemId),
    targetType: item.type || "material",
    kind: ENGAGEMENT_TARGET_KIND.SNAPSHOT_ITEM,
    unitId: item.unitId != null ? String(item.unitId) : null,
    lessonId: item.lessonId != null ? String(item.lessonId) : null,
    priority: ENGAGEMENT_PRIORITY.INTERACTED_ELEMENT,
  };
}
