/**
 * Point 4 — item progress aggregation, snapshot freeze, migration contracts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTENT_SNAPSHOT_SCHEMA_VERSION,
  freezeSnapshotItem,
} from "../src/platform/contentAssignApi.js";
import { buildSnapshotReaderModel } from "../src/platform/contentSnapshotReader.js";
import {
  ITEM_PROGRESS_STATUS,
  bridgeSubmissionToItemProgress,
  canAdvanceItemStatus,
  deriveProgressAggregates,
  evaluateVideoPlayerCompletion,
  isSnapshotItemRequired,
  listSnapshotItems,
  resolveItemCompletionRule,
  resolveVideoCompletionThreshold,
  snapshotHasTrackableItems,
  submissionCountsAsItemProgressComplete,
} from "../src/platform/activityItemProgress.js";
import {
  PROCESS_STATUS,
  submissionReachesItemProgressComplete,
} from "../src/platform/submissionWorkflow.js";
import { listCourseAssignedContentActivities } from "../src/platform/courseActivityApi.js";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260930200054_activity_item_progress.sql",
);

const contentSnapshotV3 = {
  schemaVersion: 3,
  sourceType: "content",
  sourceId: "c1",
  title: "Curso",
  units: [
    {
      id: "u1",
      title: "U1",
      position: 0,
      lessons: [
        {
          id: "l1",
          title: "L1",
          position: 0,
          items: [
            {
              snapshotItemId: "i1",
              sourceItemId: "i1",
              type: "material",
              title: "Leer",
              position: 0,
              content: {},
              config: { required: true, completion_rule: "marked_complete" },
            },
            {
              snapshotItemId: "i2",
              sourceItemId: "i2",
              type: "video",
              title: "Ver",
              position: 1,
              content: { url: "https://example.com/v.mp4" },
              config: { required: true, completion_rule: "video_threshold", completion_threshold: 0.8 },
            },
            {
              snapshotItemId: "i3",
              sourceItemId: "i3",
              type: "example",
              title: "Opcional",
              position: 2,
              content: {},
              config: { required: false },
            },
          ],
        },
      ],
    },
    {
      id: "u2",
      title: "U2",
      position: 1,
      lessons: [
        {
          id: "l2",
          title: "L2",
          position: 0,
          items: [
            {
              snapshotItemId: "i4",
              type: "exercise",
              title: "Code",
              position: 0,
              content: {},
              config: { completion_rule: "submitted" },
            },
          ],
        },
      ],
    },
  ],
};

const legacySnapshot = {
  schemaVersion: 2,
  sourceType: "content",
  sourceId: "c-old",
  title: "Legacy",
  units: [
    {
      id: "u",
      title: "U",
      position: 0,
      lessons: [
        {
          id: "l",
          title: "L",
          position: 0,
          document_json: [],
        },
      ],
    },
  ],
};

test("schema version is 3 and freezeSnapshotItem materializes identity", () => {
  assert.equal(CONTENT_SNAPSHOT_SCHEMA_VERSION, 3);
  const frozen = freezeSnapshotItem({
    id: "abc",
    type: "quiz",
    title: "Q",
    position: 2,
    content: { questions: [1] },
    config: { required: true },
  });
  assert.equal(frozen.snapshotItemId, "abc");
  assert.equal(frozen.sourceItemId, "abc");
  assert.equal(frozen.type, "quiz");
  assert.deepEqual(frozen.content, { questions: [1] });
  assert.equal(frozen.config.required, true);
});

test("listSnapshotItems walks Unit → Lesson → Item; legacy without items is empty", () => {
  const items = listSnapshotItems(contentSnapshotV3);
  assert.deepEqual(
    items.map((i) => i.snapshotItemId),
    ["i1", "i2", "i3", "i4"],
  );
  assert.equal(items[0].unitId, "u1");
  assert.equal(items[3].lessonId, "l2");
  assert.equal(listSnapshotItems(legacySnapshot).length, 0);
  assert.equal(snapshotHasTrackableItems(legacySnapshot), false);
  assert.equal(snapshotHasTrackableItems(contentSnapshotV3), true);
});

test("optional items do not reduce required completion percentage", () => {
  const items = listSnapshotItems(contentSnapshotV3);
  assert.equal(isSnapshotItemRequired(items.find((i) => i.snapshotItemId === "i3")), false);

  const none = deriveProgressAggregates(items, {});
  assert.equal(none.content.total, 3); // i1,i2,i4 required; i3 optional
  assert.equal(none.content.completed, 0);
  assert.equal(none.content.percent, 0);
  assert.equal(none.content.emptyRequired, false);

  const partial = deriveProgressAggregates(items, {
    i1: { status: "completed" },
    i3: { status: "completed" }, // optional complete must not change denominator
  });
  assert.equal(partial.content.completed, 1);
  assert.equal(partial.content.total, 3);
  assert.ok(partial.content.percent > 0 && partial.content.percent < 100);

  const allReq = deriveProgressAggregates(items, {
    i1: { status: "completed" },
    i2: { status: "completed" },
    i4: { status: "completed" },
  });
  assert.equal(allReq.content.percent, 100);
  assert.equal(allReq.content.completed, 3);
});

test("empty/no-required aggregation is deterministic without NaN", () => {
  const onlyOptional = [
    {
      snapshotItemId: "o1",
      type: "material",
      config: { required: false },
      lessonId: "l",
      unitId: "u",
    },
  ];
  const agg = deriveProgressAggregates(onlyOptional, {});
  assert.equal(agg.content.emptyRequired, true);
  assert.equal(agg.content.percent, 100);
  assert.equal(Number.isNaN(agg.content.percent), false);

  const empty = deriveProgressAggregates([], {});
  assert.equal(empty.trackable, false);
  assert.equal(empty.content.emptyRequired, true);
  assert.equal(Number.isFinite(empty.content.percent), true);
});

test("progress status machine is forward-only and limited to three states", () => {
  assert.ok(canAdvanceItemStatus("not_started", "in_progress"));
  assert.ok(canAdvanceItemStatus("in_progress", "completed"));
  assert.ok(canAdvanceItemStatus("not_started", "completed"));
  assert.equal(canAdvanceItemStatus("completed", "in_progress"), false);
  assert.deepEqual(Object.values(ITEM_PROGRESS_STATUS).sort(), [
    "completed",
    "in_progress",
    "not_started",
  ]);
});

test("completion rules and video threshold use player events only", () => {
  assert.equal(
    resolveItemCompletionRule({ type: "material", config: {} }),
    "marked_complete",
  );
  assert.equal(resolveItemCompletionRule({ type: "video", config: {} }), "video_threshold");
  assert.equal(resolveItemCompletionRule({ type: "quiz", config: {} }), "quiz_finished");
  assert.equal(resolveVideoCompletionThreshold({ config: { completion_threshold: 0.8 } }), 0.8);
  assert.equal(resolveVideoCompletionThreshold({ config: {} }), 1);

  const item = { config: { completion_threshold: 0.8 } };
  assert.equal(
    evaluateVideoPlayerCompletion(item, { currentTime: 80, duration: 100, ended: false }),
    true,
  );
  assert.equal(
    evaluateVideoPlayerCompletion(item, { currentTime: 50, duration: 100, ended: false }),
    false,
  );
  assert.equal(evaluateVideoPlayerCompletion(item, { ended: true }), true);

  const src = readFileSync(resolve(root, "src/platform/activityItemProgress.js"), "utf8");
  assert.doesNotMatch(src, /active_ms/);
  assert.doesNotMatch(src, /engagement.?time/i);
  assert.doesNotMatch(src, /session.?duration/i);
});

test("aggregates derive lesson/unit/content from items (not stored primary truth)", () => {
  const items = listSnapshotItems(contentSnapshotV3);
  const agg = deriveProgressAggregates(items, {
    i1: { status: "completed" },
    i2: { status: "completed" },
  });
  assert.equal(agg.lessons.l1.completed, 2);
  assert.equal(agg.lessons.l1.total, 2);
  assert.equal(agg.lessons.l1.percent, 100);
  assert.equal(agg.units.u1.percent, 100);
  assert.equal(agg.units.u2.percent, 0);
  assert.equal(agg.content.percent, Math.round((2 / 3) * 1000) / 10);
});

test("reader model exposes items without breaking legacy snapshots", () => {
  const model = buildSnapshotReaderModel(contentSnapshotV3);
  assert.equal(model.mode, "multi");
  assert.equal(model.orderedLessons[0].items.length, 3);
  assert.equal(model.trackableItems.length, 4);

  const legacy = buildSnapshotReaderModel(legacySnapshot);
  assert.equal(legacy.mode, "multi");
  assert.equal(legacy.trackableItems.length, 0);
  assert.equal(legacy.orderedLessons[0].items.length, 0);
});

test("migration defines activity_item_progress + RLS helpers + RPCs without drops", () => {
  assert.ok(existsSync(migrationPath));
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.activity_item_progress/);
  assert.match(sql, /snapshot_item_id text not null/);
  assert.match(sql, /source_item_id uuid null/);
  assert.match(sql, /not_started.*in_progress.*completed/s);
  assert.match(sql, /can_write_activity_item_progress/);
  assert.match(sql, /can_read_activity_item_progress/);
  assert.match(sql, /upsert_activity_item_progress/);
  assert.match(sql, /get_activity_item_progress/);
  assert.match(sql, /get_course_content_progress_overview/);
  assert.match(sql, /cm\.role = 'student'/);
  assert.match(sql, /is_course_teacher/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /course_content_assignments/);
  // Content ownership alone must not grant progress access
  assert.doesNotMatch(sql, /learning_contents\.owner_id/);
});

test("UI wires student viewer and teacher panel without parallel assignment entity", () => {
  const viewer = readFileSync(
    resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
    "utf8",
  );
  const page = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  const panel = readFileSync(
    resolve(root, "src/components/pybotclass/CourseContentProgressPanel.jsx"),
    "utf8",
  );
  const activities = readFileSync(
    resolve(root, "src/components/pybotclass/CourseActivitiesTab.jsx"),
    "utf8",
  );
  assert.match(viewer, /onCompleteItem|Marcar completado/);
  assert.match(viewer, /evaluateVideoPlayerCompletion/);
  assert.match(page, /AssignedContentSnapshotViewer/);
  assert.match(page, /handleStartItem|handleCompleteItem/);
  assert.match(page, /activityItemProgress/);
  assert.match(panel, /Progreso de contenido/);
  assert.match(panel, /Detalle/);
  assert.match(activities, /CourseContentProgressPanel/);
  assert.doesNotMatch(page + panel + activities, /course_content_assignments/);
  // Point 6 may display active_ms via learningStatus formatters; progress completion must stay grade/engagement-free.
  assert.match(viewer, /formatActiveTime|learningStatus/);
  assert.doesNotMatch(viewer, /activity_engagement_segments/);
  assert.doesNotMatch(viewer, /grade|max_points|earned_points/);
});

test("activity_progress IDE autosave module remains separate from item progress", () => {
  const ide = readFileSync(resolve(root, "src/platform/activityProgress.js"), "utf8");
  assert.match(ide, /save_activity_progress/);
  assert.doesNotMatch(ide, /activity_item_progress/);
  assert.doesNotMatch(ide, /snapshot_item_id/);
});

test("bridgeSubmissionToItemProgress is exported for submission workflow", () => {
  assert.equal(typeof bridgeSubmissionToItemProgress, "function");
  const sub = readFileSync(resolve(root, "src/platform/activitySubmissions.js"), "utf8");
  assert.match(sub, /bridgeSubmissionToItemProgress/);
});

test("Point 4 bridges courseActivityApi and submissionWorkflow (AC18 scope)", () => {
  const scopeFiles = [
    "src/platform/courseActivityApi.js",
    "src/platform/submissionWorkflow.js",
  ];
  for (const rel of scopeFiles) {
    assert.ok(existsSync(resolve(root, rel)), rel);
  }

  const courseApi = readFileSync(resolve(root, "src/platform/courseActivityApi.js"), "utf8");
  assert.match(courseApi, /listCourseAssignedContentActivities/);
  assert.match(courseApi, /content_snapshot/);
  assert.doesNotMatch(courseApi, /course_content_assignments/);
  assert.equal(typeof listCourseAssignedContentActivities, "function");

  const workflow = readFileSync(resolve(root, "src/platform/submissionWorkflow.js"), "utf8");
  assert.match(workflow, /submissionReachesItemProgressComplete/);
  assert.match(workflow, /PROCESS_STATUS\.SUBMITTED/);
  assert.equal(submissionReachesItemProgressComplete(PROCESS_STATUS.SUBMITTED), true);
  assert.equal(submissionReachesItemProgressComplete(PROCESS_STATUS.IN_PROGRESS), false);
  assert.equal(submissionReachesItemProgressComplete(PROCESS_STATUS.GRADED), true);
  assert.equal(
    submissionCountsAsItemProgressComplete({ status: "submitted", version: 1 }),
    true,
  );
  assert.equal(
    submissionCountsAsItemProgressComplete({ status: "draft", version: 1 }),
    false,
  );

  const itemProgress = readFileSync(resolve(root, "src/platform/activityItemProgress.js"), "utf8");
  assert.match(itemProgress, /from "\.\/courseActivityApi\.js"/);
  assert.match(itemProgress, /from "\.\/submissionWorkflow\.js"/);
  assert.match(itemProgress, /submissionCountsAsItemProgressComplete/);
  assert.match(itemProgress, /listCourseAssignedContentActivities/);
});

test("assign API loads lesson items into new snapshots", () => {
  const src = readFileSync(resolve(root, "src/platform/contentAssignApi.js"), "utf8");
  assert.match(src, /listLessonItems/);
  assert.match(src, /loadFrozenLessonItems/);
  assert.match(src, /items,/);
  assert.equal(CONTENT_SNAPSHOT_SCHEMA_VERSION, 3);
});
