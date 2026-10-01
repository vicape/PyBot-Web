/**
 * Point 5 — engagement state machine, video semantics, aggregation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  ENGAGEMENT_INACTIVITY_MS,
  ENGAGEMENT_SYNC_INTERVAL_MS,
  ENGAGEMENT_TARGET_KIND,
  assignedIdeTargetId,
  createEngagementManager,
  deriveEngagementAggregates,
  lessonDocumentTargetId,
  resolveAssignedIdeEngagementTarget,
  resolveLessonDocumentEngagementTarget,
  resolveSnapshotItemEngagementTarget,
  sumEngagementByTarget,
} from "../src/platform/activityEngagement.js";

const root = resolve(import.meta.dirname, "..");

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
      return t;
    },
    set: (ms) => {
      t = ms;
      return t;
    },
  };
}

function materialTarget(id = "m1") {
  return {
    targetId: id,
    targetType: "material",
    kind: ENGAGEMENT_TARGET_KIND.SNAPSHOT_ITEM,
    unitId: "u1",
    lessonId: "l1",
  };
}

function videoTarget(id = "v1") {
  return {
    targetId: id,
    targetType: "video",
    kind: ENGAGEMENT_TARGET_KIND.SNAPSHOT_ITEM,
    unitId: "u1",
    lessonId: "l1",
  };
}

test("AC1: opening visible non-video target starts active time", () => {
  const clock = fakeClock(1000);
  const flushes = [];
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => 1_700_000_000_000,
    createSegmentId: () => "seg-1",
    onFlush: (p) => flushes.push(p),
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget());
  clock.advance(5_000);
  mgr.tick();
  const snap = mgr.getSnapshot();
  assert.equal(snap.accumulating, true);
  assert.equal(snap.activeMs, 5_000);
  mgr.destroy();
});

test("AC2: idle pause after 90s without interaction", () => {
  const clock = fakeClock(0);
  const flushes = [];
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => "seg-idle",
    inactivityMs: ENGAGEMENT_INACTIVITY_MS,
    onFlush: (p) => flushes.push(p),
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget());
  clock.advance(ENGAGEMENT_INACTIVITY_MS - 1);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, true);
  clock.advance(2);
  mgr.tick();
  const snap = mgr.getSnapshot();
  assert.equal(snap.accumulating, false);
  assert.equal(snap.idlePaused, true);
  assert.ok(flushes.some((f) => f.ended && f.reason === "idle"));
  mgr.destroy();
});

test("AC3: interaction after idle starts accumulation again", () => {
  const clock = fakeClock(0);
  let seg = 0;
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => `seg-${++seg}`,
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget());
  clock.advance(ENGAGEMENT_INACTIVITY_MS + 10);
  mgr.tick();
  assert.equal(mgr.getSnapshot().idlePaused, true);
  const pausedMs = mgr.getSnapshot().activeMs;
  mgr.noteInteraction();
  assert.equal(mgr.getSnapshot().accumulating, true);
  assert.equal(mgr.getSnapshot().clientSegmentId, "seg-2");
  clock.advance(1_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().activeMs, 1_000);
  assert.equal(pausedMs, 0); // prior segment ended and cleared from live snapshot
  mgr.destroy();
});

test("AC4/AC5: hide pauses immediately; visible alone does not resume", () => {
  const clock = fakeClock(0);
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => "seg-vis",
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget());
  clock.advance(2_000);
  mgr.tick();
  mgr.setDocumentVisible(false);
  assert.equal(mgr.getSnapshot().accumulating, false);
  clock.advance(10_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);
  mgr.setDocumentVisible(true);
  assert.equal(mgr.getSnapshot().accumulating, false);
  clock.advance(5_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);
  mgr.noteInteraction();
  assert.equal(mgr.getSnapshot().accumulating, true);
  mgr.destroy();
});

test("AC6/AC7: target switch stops previous; single timer", () => {
  const clock = fakeClock(0);
  const flushes = [];
  let seg = 0;
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => `seg-${++seg}`,
    onFlush: (p) => flushes.push({ ...p }),
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget("m1"));
  clock.advance(3_000);
  mgr.tick();
  mgr.setTarget(materialTarget("m2"));
  const ended = flushes.filter((f) => f.ended && f.targetId === "m1");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].activeMs, 3_000);
  clock.advance(2_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "m2");
  assert.equal(mgr.getSnapshot().activeMs, 2_000);
  mgr.destroy();
});

test("AC8-AC11/AC30: video only while playing; seek/buffer/end/hidden skip; wall-clock not media timeline", () => {
  const clock = fakeClock(0);
  const flushes = [];
  let seg = 0;
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => `vseg-${++seg}`,
    onFlush: (p) => flushes.push({ ...p }),
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(videoTarget());
  assert.equal(mgr.getSnapshot().accumulating, false);

  mgr.setVideoMediaState({ playing: true });
  clock.advance(4_000); // wall-clock 4s even if media advanced 8s at 2x
  mgr.tick();
  assert.equal(mgr.getSnapshot().activeMs, 4_000);

  mgr.setVideoMediaState({ playing: false, waiting: true });
  clock.advance(3_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);

  mgr.setVideoMediaState({ playing: true, waiting: false });
  clock.advance(1_000);
  mgr.tick();

  mgr.setVideoMediaState({ seeking: true, playing: false });
  clock.advance(5_000); // seek skip must not add
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);

  mgr.setVideoMediaState({ playing: true, seeking: false });
  clock.advance(500);
  mgr.tick();

  mgr.setDocumentVisible(false);
  clock.advance(2_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);

  mgr.setDocumentVisible(true);
  // visible alone does not resume video unless still marked playing — re-assert play
  mgr.setVideoMediaState({ playing: true });
  clock.advance(200);
  mgr.tick();

  mgr.setVideoMediaState({ ended: true, playing: false });
  assert.equal(mgr.getSnapshot().accumulating, false);

  const videoFlushes = flushes.filter((f) => f.targetId === "v1");
  const total = videoFlushes.reduce((s, f) => Math.max(s, f.activeMs), 0);
  // Live segments end separately; ensure no seek/buffer chunk inflated wall time unrealistically
  assert.ok(total <= 10_000);
  mgr.destroy();
});

test("AC12: playing video pauses overlapping lesson/material timer", () => {
  const clock = fakeClock(0);
  const flushes = [];
  let seg = 0;
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => `seg-${++seg}`,
    onFlush: (p) => flushes.push({ ...p }),
  });
  mgr.setDocumentVisible(true);
  const lesson = resolveLessonDocumentEngagementTarget({ id: "l1", unitId: "u1" });
  mgr.setLessonDocumentTarget(lesson);
  clock.advance(2_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, lessonDocumentTargetId("l1"));

  mgr.setTarget(videoTarget());
  mgr.setVideoMediaState({ playing: true });
  clock.advance(3_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "v1");
  assert.equal(mgr.getSnapshot().activeMs, 3_000);

  const lessonEnded = flushes.filter((f) => f.targetId === lessonDocumentTargetId("l1") && f.ended);
  assert.ok(lessonEnded.length >= 1);
  assert.equal(lessonEnded[0].activeMs, 2_000);
  mgr.destroy();
});

test("AC13/AC14: assigned IDE target helper; generic has no activity id", () => {
  const t = resolveAssignedIdeEngagementTarget("act-9", { activity_kind: "exercise" }, null);
  assert.equal(t.targetId, assignedIdeTargetId("act-9"));
  assert.equal(t.kind, ENGAGEMENT_TARGET_KIND.ASSIGNED_IDE);
  assert.equal(resolveAssignedIdeEngagementTarget(null), null);
});

test("AC27-AC29: aggregation element→lesson→unit→content without parent double count", () => {
  const snapshot = {
    sourceType: "content",
    units: [
      {
        id: "u1",
        lessons: [
          {
            id: "l1",
            items: [
              { snapshotItemId: "i1", type: "material" },
              { snapshotItemId: "i2", type: "video" },
            ],
          },
          {
            id: "l2",
            items: [{ snapshotItemId: "i3", type: "exercise" }],
          },
        ],
      },
    ],
  };
  const segments = [
    { target_id: "i1", target_type: "material", unit_id: "u1", lesson_id: "l1", active_ms: 1000 },
    { target_id: "i2", target_type: "video", unit_id: "u1", lesson_id: "l1", active_ms: 2000 },
    { target_id: lessonDocumentTargetId("l1"), target_type: "material", unit_id: "u1", lesson_id: "l1", active_ms: 500 },
    { target_id: "i3", target_type: "exercise", unit_id: "u1", lesson_id: "l2", active_ms: 3000 },
  ];
  const agg = deriveEngagementAggregates(snapshot, segments);
  assert.equal(agg.targets.i1.activeMs, 1000);
  assert.equal(agg.targets.i2.activeMs, 2000);
  assert.equal(agg.lessons.l1.activeMs, 1000 + 2000 + 500);
  assert.equal(agg.lessons.l2.activeMs, 3000);
  assert.equal(agg.units.u1.activeMs, 1000 + 2000 + 500 + 3000);
  assert.equal(agg.content.activeMs, agg.units.u1.activeMs);
  // Parent is sum of children, not duplicated stored totals
  assert.equal(
    agg.units.u1.activeMs,
    Object.values(agg.units.u1.lessons).reduce((a, b) => a + b, 0),
  );
});

test("AC15: progress module remains separate from engagement storage", () => {
  const progress = readFileSync(resolve(root, "src/platform/activityItemProgress.js"), "utf8");
  const engagement = readFileSync(resolve(root, "src/platform/activityEngagement.js"), "utf8");
  assert.doesNotMatch(progress, /activity_engagement_segments/);
  assert.doesNotMatch(engagement, /activity_item_progress/);
  assert.doesNotMatch(engagement, /upsert_activity_item_progress/);
});

test("constants: 90s idle and ~15s sync", () => {
  // Exact inactivity boundary is 90,000 ms
  assert.equal(ENGAGEMENT_INACTIVITY_MS, 90_000);
  assert.equal(ENGAGEMENT_INACTIVITY_MS, 90000);
  assert.equal(ENGAGEMENT_SYNC_INTERVAL_MS, 15_000);
});

test("snapshot item / lesson helpers", () => {
  const item = resolveSnapshotItemEngagementTarget({
    snapshotItemId: "x",
    type: "example",
    unitId: "u",
    lessonId: "l",
  });
  assert.equal(item.targetId, "x");
  assert.equal(item.targetType, "example");
  assert.equal(sumEngagementByTarget([{ targetId: "x", activeMs: 10 }]).x.activeMs, 10);
});

test("migration file exists and separates engagement from progress", () => {
  const path = resolve(root, "supabase/migrations/20260930233000_activity_engagement_segments.sql");
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /activity_engagement_segments/);
  assert.match(sql, /upsert_activity_engagement_segment/);
  assert.match(sql, /get_activity_engagement_segments/);
  assert.match(sql, /can_write_activity_engagement/);
  assert.match(sql, /can_read_activity_engagement/);
  assert.doesNotMatch(sql, /alter table public\.activity_item_progress/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /keystroke|pointer_x|scroll_y|typed_text/i);
});

test("viewer wires optional engagement without SharedContent tracking", () => {
  const viewer = readFileSync(
    resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
    "utf8",
  );
  const activity = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  const shared = readFileSync(resolve(root, "src/pages/SharedContentPage.jsx"), "utf8");
  const ide = readFileSync(resolve(root, "src/PyBotIDE.jsx"), "utf8");
  const hook = readFileSync(resolve(root, "src/platform/useActivityEngagement.js"), "utf8");
  assert.match(viewer, /engagement/);
  assert.match(viewer, /activateLessonDocument/);
  assert.match(viewer, /onPlay=\{[\s\S]*?setItemTarget/);
  assert.match(viewer, /onPlaying=\{[\s\S]*?playing: true/);
  assert.match(activity, /useActivityEngagement/);
  assert.match(activity, /engagement=\{isStudent \? engagement : null\}/);
  assert.match(activity, /content_lesson_id/);
  assert.match(activity, /activateLessonDocument/);
  assert.doesNotMatch(shared, /useActivityEngagement/);
  assert.match(ide, /useActivityEngagement/);
  assert.match(ide, /mode: "ide"/);
  // F1: stable API across rerenders
  assert.match(hook, /useMemo/);
  assert.match(hook, /activateLessonDocument/);
});

test("F1: same-target continuity — rerender-equivalent setTarget keeps segment", () => {
  const clock = fakeClock(0);
  let seg = 0;
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => 1_700_000_000_000,
    createSegmentId: () => `seg-${++seg}`,
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget("m1"));
  clock.advance(2_000);
  mgr.tick();
  const id1 = mgr.getSnapshot().clientSegmentId;
  const ms1 = mgr.getSnapshot().activeMs;
  // Equivalent to React rerender re-applying the same target (not a leave/restart)
  mgr.setTarget(materialTarget("m1"));
  clock.advance(1_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().clientSegmentId, id1);
  assert.equal(mgr.getSnapshot().activeMs, ms1 + 1_000);
  assert.equal(seg, 1);
  mgr.destroy();
});

test("F2: item → lesson → item attribution; video priority overrides", () => {
  const clock = fakeClock(0);
  let seg = 0;
  const flushes = [];
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => `seg-${++seg}`,
    onFlush: (p) => flushes.push({ ...p }),
  });
  const lesson = resolveLessonDocumentEngagementTarget({ id: "l1", unitId: "u1" });
  mgr.setDocumentVisible(true);
  mgr.setLessonDocumentTarget(lesson);
  clock.advance(1_000);
  mgr.tick();

  mgr.setTarget(materialTarget("item-1"));
  clock.advance(2_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "item-1");

  mgr.activateLessonDocument();
  clock.advance(3_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, lessonDocumentTargetId("l1"));
  assert.equal(mgr.getSnapshot().activeMs, 3_000);

  mgr.setTarget(materialTarget("item-2"));
  clock.advance(500);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "item-2");

  // Playing video overrides lesson activation
  mgr.setTarget(videoTarget("v1"));
  mgr.setVideoMediaState({ playing: true });
  clock.advance(1_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "v1");
  mgr.activateLessonDocument();
  assert.equal(mgr.getSnapshot().currentTarget.targetId, "v1");
  assert.equal(mgr.getSnapshot().videoPlaying, true);
  mgr.destroy();
});

test("F7: delayed tick at exactly 90_000 ms boundary credits capped total", () => {
  const clock = fakeClock(0);
  const flushes = [];
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => "seg-idle-cap",
    inactivityMs: ENGAGEMENT_INACTIVITY_MS,
    onFlush: (p) => flushes.push({ ...p }),
  });
  mgr.setDocumentVisible(true);
  mgr.setTarget(materialTarget());
  // Single late tick past the 90,000 ms boundary — must not discard the eligible interval
  clock.advance(ENGAGEMENT_INACTIVITY_MS + 50_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);
  assert.equal(mgr.getSnapshot().idlePaused, true);
  const idleFlush = flushes.find((f) => f.reason === "idle" && f.ended);
  assert.ok(idleFlush);
  assert.equal(idleFlush.activeMs, ENGAGEMENT_INACTIVITY_MS);
  assert.equal(idleFlush.activeMs, 90_000);
  mgr.destroy();
});

test("F8: onPlay-equivalent prepare yields 0 active; onPlaying starts wall-clock", () => {
  const clock = fakeClock(0);
  const mgr = createEngagementManager({
    activityId: "act-1",
    now: clock.now,
    wallNow: () => Date.now(),
    createSegmentId: () => "vseg-play",
  });
  mgr.setDocumentVisible(true);
  // onPlay may select/prepare video target without starting accumulation
  mgr.setTarget(videoTarget(), { startIfEligible: false });
  clock.advance(5_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);
  assert.equal(mgr.getSnapshot().activeMs, 0);

  // onPlaying starts
  mgr.setVideoMediaState({ playing: true });
  clock.advance(2_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().activeMs, 2_000);

  mgr.setVideoMediaState({ playing: false, waiting: true });
  clock.advance(3_000);
  mgr.tick();
  assert.equal(mgr.getSnapshot().accumulating, false);
  mgr.destroy();
});

test("F9: legacy content_lesson_id lesson-document target helper is deterministic", () => {
  const lessonId = "legacy-lesson-uuid";
  const t = resolveLessonDocumentEngagementTarget({ id: lessonId, unitId: null });
  assert.equal(t.targetId, lessonDocumentTargetId(lessonId));
  assert.equal(t.kind, ENGAGEMENT_TARGET_KIND.LESSON_DOCUMENT);
  assert.equal(t.lessonId, lessonId);
  assert.equal(t.unitId, null);
  const activity = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  assert.match(activity, /content_lesson_id/);
  assert.match(activity, /setLessonDocument/);
  // Must not invent unit/item hierarchy for legacy path
  assert.doesNotMatch(activity, /fabricate|fakeUnit|syntheticUnit/);
});
