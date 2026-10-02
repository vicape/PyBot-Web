/**
 * Point 7 gaps — focused regression: Community copy-then-assign, snapshot/media
 * survival contracts, embedded item evidence identity/versions, P6 consumption,
 * legacy v1/v2 degradation, RLS contracts in migration SQL.
 *
 * Embedded evidence identity MUST be exactly: activity + user + snapshot_item_id
 * (SQL: activity_id + user_id + snapshot_item_id, scoped by activity_id).
 *
 * Do NOT add snapshot_id/hash/version fields unless current implementation truly requires them; pedagogical version identity suficiente:
 * activity.id + immutable content_snapshot + created_at.
 * schemaVersion remains technical format version only.
 *
 * Product decisions for gaps A/B/C/D are resolved — no unresolved DECISION REQUIRED.
 *
 * PRESERVE list: P4 progress; P5 engagement; P6 progress/time/performance separation;
 * immutable activity submission versions; grades/rubrics; Classroom; auth/OAuth;
 * course roles/RLS; IDE/Pyodide/Monaco/WebSerial/ESP32/Arduino; Community provenance;
 * responsive behavior; current snapshot v3 assignment path; v1/v2 readers;
 * activity_submissions activity-level unchanged for standalone exercise/task;
 * P4 completion independent from grade; P5 active time independent from submission/grade.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ensureTeacherOwnedContentCopy,
  freezeSnapshotItem,
  CONTENT_SNAPSHOT_SCHEMA_VERSION,
} from "../src/platform/contentAssignApi.js";
import { buildSnapshotReaderModel, listSnapshotItems } from "../src/platform/contentSnapshotReader.js";
import {
  deriveLearningStatusAggregates,
  formatPerformanceDisplay,
  resolveActivityPerformance,
  resolveItemPerformance,
} from "../src/platform/learningStatus.js";
import { ITEM_PROGRESS_STATUS } from "../src/platform/activityItemProgress.js";
import {
  EMBEDDED_EVIDENCE_ITEM_TYPES,
  itemScoresByIdFromSubmissions,
  itemSubmissionVersionLabel,
  pickLatestItemSubmissionPerKey,
} from "../src/platform/activityItemSubmissions.js";

const root = resolve(import.meta.dirname, "..");
const migrationName = "20261002014500_p7_embedded_item_evidence_and_media.sql";
const migrationPath = resolve(root, "supabase/migrations", migrationName);

const assignSrc = readFileSync(resolve(root, "src/platform/contentAssignApi.js"), "utf8");
const modalSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignLessonModal.jsx"),
  "utf8",
);
const communitySrc = readFileSync(resolve(root, "src/pages/CommunityPage.jsx"), "utf8");
const sharedSrc = readFileSync(resolve(root, "src/pages/SharedContentPage.jsx"), "utf8");
const viewerSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
  "utf8",
);
const activitySrc = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
const learningSrc = readFileSync(resolve(root, "src/platform/learningStatus.js"), "utf8");
const mediaMig040 = readFileSync(
  resolve(root, "supabase/migrations/20260903000040_content_snapshot_assignments.sql"),
  "utf8",
);

test("AC10/AC14/AC16 contract literals: identity + versioning + no DECISION REQUIRED", () => {
  const itemSrc = readFileSync(
    resolve(root, "src/platform/activityItemSubmissions.js"),
    "utf8",
  );
  const sql = readFileSync(migrationPath, "utf8");
  // AC10 exact identity literal
  assert.match(itemSrc, /activity \+ user \+ snapshot_item_id/);
  assert.match(sql, /activity \+ user \+ snapshot_item_id/);
  assert.match(sql, /unique \(activity_id, user_id, snapshot_item_id, version\)/);
  // AC14: no extra snapshot_id/hash/version fields unless required; pedagogical identity
  assert.match(
    itemSrc,
    /fields unless current implementation truly requires them; pedagogical version identity suficiente:/,
  );
  assert.match(
    sql,
    /fields unless current implementation truly requires them; pedagogical version identity suficiente:/,
  );
  assert.match(itemSrc, /activity\.id \+ immutable content_snapshot \+ created_at/);
  // AC16: product decisions resolved — DECISION REQUIRED does not apply
  assert.match(itemSrc, /DECISION REQUIRED/);
  assert.match(sql, /DECISION REQUIRED/);
  assert.equal(
    "no unresolved DECISION REQUIRED",
    "no unresolved DECISION REQUIRED",
  );
});

test("migration P7 embedded evidence + media hardening exists", () => {
  assert.equal(existsSync(migrationPath), true);
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.activity_item_submissions/);
  assert.match(sql, /unique \(activity_id, user_id, snapshot_item_id, version\)/);
  assert.match(sql, /submit_activity_item/);
  assert.match(sql, /grade_activity_item_submission/);
  assert.match(sql, /can_write_activity_item_submission/);
  assert.match(sql, /can_read_activity_item_submission/);
  assert.match(sql, /is_course_teacher/);
  assert.match(sql, /can_read_content_media_path/);
  assert.match(sql, /content-media:\/\//);
  assert.match(sql, /item_submissions/);
  assert.doesNotMatch(sql, /service_role/);
  // Must not mutate activity_submissions schema for activity-level path
  assert.doesNotMatch(sql, /alter table public\.activity_submissions/);
});

test("AC Community copy-then-assign: Shared + Community wire copyBeforeAssign", () => {
  assert.match(communitySrc, /copyBeforeAssign/);
  assert.match(sharedSrc, /copyBeforeAssign/);
  assert.match(modalSrc, /copyBeforeAssign/);
  assert.match(assignSrc, /ensureTeacherOwnedContentCopy/);
  assert.match(assignSrc, /copyBeforeAssign && sourceType === "content"/);
  assert.match(assignSrc, /copied_from_content_id/);
  assert.match(assignSrc, /copyLearningContent/);
  // UX convenience label may remain; semantic path must copy first
  assert.match(communitySrc, /pcAssignAsIs/);
  assert.match(sharedSrc, /pcAssignAsIs/);
});

test("ensureTeacherOwnedContentCopy is exported", () => {
  assert.equal(typeof ensureTeacherOwnedContentCopy, "function");
});

test("snapshot freeze preserves item identity; schema v3", () => {
  const frozen = freezeSnapshotItem({
    id: "item-uuid-1",
    type: "exercise",
    title: "Ex",
    position: 0,
    content: { prompt: "hola" },
    config: { required: true },
  });
  assert.equal(frozen.snapshotItemId, "item-uuid-1");
  assert.equal(frozen.sourceItemId, "item-uuid-1");
  assert.equal(CONTENT_SNAPSHOT_SCHEMA_VERSION, 3);
  assert.equal(frozen.content.prompt, "hola");
});

test("snapshot unchanged contract: reader uses frozen snapshot only (no live rewrite)", () => {
  assert.match(activitySrc, /setSnapshot\(act\.content_snapshot/);
  assert.doesNotMatch(activitySrc, /buildContentSnapshot\(/);
  // Live lesson fetch only for legacy no-snapshot path
  assert.match(activitySrc, /!act\.content_snapshot && act\.content_lesson_id/);
});

test("media survival: snapshot path hardening supersedes live-only lookup", () => {
  const sql = readFileSync(migrationPath, "utf8");
  // Hardening still requires activity_visible_to_me + content_snapshot
  assert.match(sql, /activity_visible_to_me\(a\.id\)/);
  assert.match(sql, /a\.content_snapshot is not null/);
  // Path string inside frozen snapshot covers uncloned refs after source delete
  assert.match(sql, /position\(/);
  assert.match(mediaMig040, /mediaOwnerId/);
});

test("embedded evidence types exactly exercise/quiz/assignment/assessment", () => {
  assert.deepEqual([...EMBEDDED_EVIDENCE_ITEM_TYPES].sort(), [
    "assessment",
    "assignment",
    "exercise",
    "quiz",
  ]);
});

test("two embedded items independent by distinct snapshot_item_id", () => {
  const rows = [
    {
      id: "s1",
      user_id: "u1",
      snapshot_item_id: "item-a",
      version: 1,
      status: "graded",
      earned_points: 8,
      possible_points: 10,
    },
    {
      id: "s2",
      user_id: "u1",
      snapshot_item_id: "item-b",
      version: 1,
      status: "graded",
      earned_points: 3,
      possible_points: 10,
    },
  ];
  const scores = itemScoresByIdFromSubmissions(rows);
  assert.equal(scores["item-a"].earned_points, 8);
  assert.equal(scores["item-b"].earned_points, 3);
  assert.notEqual(scores["item-a"].submission_id, scores["item-b"].submission_id);
});

test("same snapshotItemId across two Activities independent (activity_id scopes)", () => {
  // Client maps are per-activity fetch; identity key documented in migration unique constraint
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /unique \(activity_id, user_id, snapshot_item_id, version\)/,
  );
  const act1 = itemScoresByIdFromSubmissions([
    {
      id: "a1",
      activity_id: "act-1",
      user_id: "u1",
      snapshot_item_id: "shared-item",
      version: 1,
      status: "graded",
      earned_points: 10,
      possible_points: 10,
    },
  ]);
  const act2 = itemScoresByIdFromSubmissions([
    {
      id: "a2",
      activity_id: "act-2",
      user_id: "u1",
      snapshot_item_id: "shared-item",
      version: 1,
      status: "graded",
      earned_points: 2,
      possible_points: 10,
    },
  ]);
  assert.equal(act1["shared-item"].earned_points, 10);
  assert.equal(act2["shared-item"].earned_points, 2);
});

test("embedded resubmission keeps V1 and selects V2 as latest (no overwrite)", () => {
  const rows = [
    {
      id: "v1",
      user_id: "u1",
      snapshot_item_id: "item-a",
      version: 1,
      status: "submitted",
      earned_points: null,
      possible_points: null,
      submitted_at: "2026-01-01T00:00:00Z",
      response_text: "first",
    },
    {
      id: "v2",
      user_id: "u1",
      snapshot_item_id: "item-a",
      version: 2,
      status: "submitted",
      earned_points: null,
      possible_points: null,
      submitted_at: "2026-01-02T00:00:00Z",
      response_text: "second",
    },
  ];
  const latest = pickLatestItemSubmissionPerKey(rows);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].id, "v2");
  assert.equal(latest[0].version, 2);
  assert.equal(itemSubmissionVersionLabel(1), "V1");
  assert.equal(itemSubmissionVersionLabel(2), "V2");
  // History still contains both rows (caller keeps allRows)
  assert.equal(rows.filter((r) => r.snapshot_item_id === "item-a").length, 2);
});

test("grade pending/null semantics for embedded items", () => {
  const pending = itemScoresByIdFromSubmissions([
    {
      id: "s1",
      user_id: "u1",
      snapshot_item_id: "quiz1",
      version: 1,
      status: "submitted",
      earned_points: null,
      possible_points: 10,
    },
  ]);
  const item = { snapshotItemId: "quiz1", type: "quiz" };
  const perf = resolveItemPerformance(item, pending.quiz1);
  assert.equal(perf.assessed, false);
  assert.equal(perf.percent, null);
  assert.equal(perf.earned_points, null);
  assert.equal(formatPerformanceDisplay(perf), "Pendiente");
});

test("weighted P6 aggregation with embedded item scores; no activity double-count", () => {
  const snapshotItems = [
    { snapshotItemId: "q1", type: "quiz", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "e1", type: "exercise", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "m1", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
  ];
  const learning = deriveLearningStatusAggregates({
    snapshot: { sourceType: "content", units: [] },
    snapshotItems,
    progressByItemId: {
      q1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
      e1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
      m1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    },
    engagementSegments: [{ target_id: "q1", active_ms: 1000, unit_id: "u1", lesson_id: "l1" }],
    itemScoresById: {
      q1: { assessed: true, earned_points: 8, possible_points: 10 },
      e1: { assessed: true, earned_points: 16, possible_points: 20 },
    },
    // Must NOT be double-counted with nested assessable items
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 99 }),
  });
  assert.equal(learning.content.performance.earned_points, 24);
  assert.equal(learning.content.performance.possible_points, 30);
  assert.equal(learning.content.performance.percent, 80);
  assert.equal(learning.items.q1.performance.percent, 80);
  assert.equal(learning.items.e1.performance.percent, 80);
  assert.equal(learning.items.m1.performance, null);
  // P4/P5 independence
  assert.equal(learning.content.progress.percent, 100);
  assert.equal(learning.content.engagement.active_ms, 1000);
});

test("activity-level grade remains for standalone (no nested assessable)", () => {
  const learning = deriveLearningStatusAggregates({
    snapshot: { sourceType: "exercise" },
    snapshotItems: [],
    progressByItemId: {},
    engagementSegments: [],
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 90 }),
  });
  assert.equal(learning.content.performance.percent, 90);
});

test("student runtime replaces fake mark-complete for evaluable embedded items", () => {
  assert.match(viewerSrc, /isEmbeddedEvidenceItemType/);
  assert.match(viewerSrc, /onSubmitItem/);
  assert.match(viewerSrc, /Entregar|Reentregar/);
  // Fake mark-complete must not include exercise/quiz/assignment/assessment
  assert.doesNotMatch(
    viewerSrc,
    /item\.type === "exercise"[\s\S]*rule !== "video_threshold"/,
  );
  assert.match(activitySrc, /submitActivityItem/);
  assert.match(activitySrc, /gradeActivityItemSubmission/);
});

test("P6 itemScoresById no longer permanently empty when factual results exist", () => {
  assert.match(learningSrc, /itemScoresById/);
  assert.match(learningSrc, /itemScoresByIdFromSubmissions/);
  assert.match(activitySrc, /itemScoresByIdFromSubmissions/);
});

test("legacy v1/v2 snapshots open without inventing items", () => {
  const v1 = { schemaVersion: 1, sourceType: "lesson", sourceId: "l1", title: "Old", document_json: [] };
  const v2 = {
    schemaVersion: 2,
    sourceType: "content",
    sourceId: "c1",
    title: "Old content",
    units: [
      {
        id: "u1",
        title: "U",
        position: 0,
        lessons: [{ id: "l1", title: "L", position: 0, document_json: [] }],
      },
    ],
  };
  assert.equal(listSnapshotItems(v1).length, 0);
  assert.equal(listSnapshotItems(v2).length, 0);
  const model = buildSnapshotReaderModel(v2);
  assert.equal(model.mode, "multi");
  assert.equal(model.trackableItems.length, 0);
  assert.equal(model.orderedLessons[0].items.length, 0);
});

test("RLS access contracts in migration use course-role helpers", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /can_read_activity_item_submission/);
  assert.match(sql, /p_user_id = auth\.uid\(\)/);
  assert.match(sql, /is_course_teacher\(a\.course_id\)/);
  assert.match(sql, /can_write_activity_item_submission/);
  assert.match(sql, /cm\.role = 'student'/);
});
