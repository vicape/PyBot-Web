/**
 * Point 6 — independent Progress / Active time / Performance read model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  aggregatePerformance,
  buildItemLearningStatus,
  deriveLearningStatusAggregates,
  formatActiveTime,
  formatPerformanceDisplay,
  formatProgressDisplay,
  isItemAssessable,
  resolveActivityPerformance,
  resolveItemPerformance,
} from "../src/platform/learningStatus.js";
import { ITEM_PROGRESS_STATUS } from "../src/platform/activityItemProgress.js";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20261002000060_course_learning_status_overview.sql",
);

const snapshot = {
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
              snapshotItemId: "mat1",
              type: "material",
              title: "Leer",
              position: 0,
              config: { required: true },
            },
            {
              snapshotItemId: "quiz1",
              type: "quiz",
              title: "Quiz",
              position: 1,
              config: { required: true },
            },
            {
              snapshotItemId: "ex1",
              type: "exercise",
              title: "Ejercicio",
              position: 2,
              config: { required: true },
            },
            {
              snapshotItemId: "opt1",
              type: "material",
              title: "Opcional",
              position: 3,
              config: { required: false },
            },
          ],
        },
      ],
    },
  ],
};

const items = [
  { snapshotItemId: "mat1", type: "material", title: "Leer", unitId: "u1", lessonId: "l1", config: { required: true } },
  { snapshotItemId: "quiz1", type: "quiz", title: "Quiz", unitId: "u1", lessonId: "l1", config: { required: true } },
  { snapshotItemId: "ex1", type: "exercise", title: "Ejercicio", unitId: "u1", lessonId: "l1", config: { required: true } },
  { snapshotItemId: "opt1", type: "material", title: "Opcional", unitId: "u1", lessonId: "l1", config: { required: false } },
];

test("migration Point 6 learning-status overview exists and is teacher-scoped", () => {
  assert.equal(existsSync(migrationPath), true);
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /get_course_learning_status_overview/);
  assert.match(sql, /is_course_teacher/);
  assert.match(sql, /activity_item_progress/);
  assert.match(sql, /activity_engagement_segments/);
  assert.match(sql, /activity_submissions/);
  assert.match(sql, /rubric_scores/);
  assert.doesNotMatch(sql, /service_role/);
});

test("AC: progress 100 / performance 65 independent", () => {
  const progressByItemId = {
    mat1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    quiz1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    ex1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
  };
  const learning = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId,
    engagementSegments: [],
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 65 }),
  });
  assert.equal(learning.content.progress.percent, 100);
  assert.equal(learning.content.performance.percent, 65);
  assert.equal(learning.content.performance.earned_points, 65);
  assert.equal(learning.content.performance.possible_points, 100);
});

test("AC: progress 60 / performance 90 independent", () => {
  // Exact 60%: complete 3 of 5 required materials.
  const five = [
    { snapshotItemId: "a", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "b", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "c", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "d", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
    { snapshotItemId: "e", type: "material", unitId: "u1", lessonId: "l1", config: { required: true } },
  ];
  const progressMap60 = {
    a: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    b: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    c: { status: ITEM_PROGRESS_STATUS.COMPLETED },
  };
  const learning = deriveLearningStatusAggregates({
    snapshot: { sourceType: "content", units: [] },
    snapshotItems: five,
    progressByItemId: progressMap60,
    engagementSegments: [],
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 90 }),
  });
  assert.equal(learning.content.progress.percent, 60);
  assert.equal(learning.content.performance.percent, 90);
});

test("non-evaluable item -> performance null (never 0)", () => {
  const mat = items[0];
  assert.equal(isItemAssessable(mat), false);
  assert.equal(resolveItemPerformance(mat), null);
  const status = buildItemLearningStatus(mat, {
    progressRow: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    activeMs: 8 * 60_000,
  });
  assert.equal(status.progress.completed, true);
  assert.equal(status.engagement.active_ms, 8 * 60_000);
  assert.equal(status.performance, null);
  assert.equal(formatPerformanceDisplay(status.performance), "—");
});

test("unassessed evaluable item -> performance null / Pendiente (never 0)", () => {
  const quiz = items[1];
  assert.equal(isItemAssessable(quiz), true);
  const perf = resolveItemPerformance(quiz, null);
  assert.equal(perf.assessable, true);
  assert.equal(perf.assessed, false);
  assert.equal(perf.percent, null);
  assert.equal(perf.earned_points, null);
  assert.equal(formatPerformanceDisplay(perf), "Pendiente");
});

test("weighted 54/70 -> 77.14%", () => {
  // Verifiable weighted case: 8/10, 16/20, 30/40 → earned=54, possible=70, performance≈77.14%
  // performance_percent = SUM(earned_points) / SUM(possible_points) * 100
  const agg = aggregatePerformance([
    { assessed: true, earned_points: 8, possible_points: 10 }, // 8/10
    { assessed: true, earned_points: 16, possible_points: 20 }, // 16/20
    { assessed: true, earned_points: 30, possible_points: 40 }, // 30/40
  ]);
  assert.equal(agg.earned_points, 54, "earned=54");
  assert.equal(agg.possible_points, 70, "possible=70");
  assert.equal(agg.percent, 77.14, "performance≈77.14%");
});

test("pending assessment excluded from denominator", () => {
  // Base 8/10 + 16/20 + 30/40 → earned=54, possible=70, performance≈77.14%
  const base = aggregatePerformance([
    { assessed: true, earned_points: 8, possible_points: 10 },
    { assessed: true, earned_points: 16, possible_points: 20 },
    { assessed: true, earned_points: 30, possible_points: 40 },
  ]);
  assert.equal(base.percent, 77.14, "performance≈77.14%");

  const withPending = aggregatePerformance([
    { assessed: true, earned_points: 8, possible_points: 10 },
    { assessed: true, earned_points: 16, possible_points: 20 },
    { assessed: true, earned_points: 30, possible_points: 40 },
    { assessed: false, assessable: true, earned_points: null, possible_points: 100, percent: null },
  ]);
  assert.equal(withPending.earned_points, 54, "earned=54");
  assert.equal(withPending.possible_points, 70, "possible=70");
  assert.equal(withPending.percent, 77.14, "performance≈77.14%");
  // Must NOT become ~31.76% (54/170)
  assert.notEqual(withPending.percent, Math.round((54 / 170) * 10000) / 100);
});

test("official grade + rubric detail not double-counted", () => {
  const perf = resolveActivityPerformance({
    maxPoints: 10,
    grade: 8,
    status: "graded",
    rubricScores: [
      { points: 3, max_points: 4 },
      { points: 4, max_points: 6 },
    ],
    rubricCriteria: [
      { max_points: 4 },
      { max_points: 6 },
    ],
  });
  assert.equal(perf.source, "official_grade");
  assert.equal(perf.earned_points, 8);
  assert.equal(perf.possible_points, 10);
  assert.equal(perf.percent, 80);
  // Rubric sum 7 must not add on top of grade
  assert.notEqual(perf.earned_points, 8 + 7);
});

test("rubric fallback only when no official grade", () => {
  const perf = resolveActivityPerformance({
    maxPoints: 10,
    grade: null,
    status: "graded",
    rubricScores: [
      { points: 3 },
      { points: 5 },
    ],
    rubricCriteria: [{ max_points: 4 }, { max_points: 6 }],
  });
  assert.equal(perf.source, "rubric_fallback");
  assert.equal(perf.earned_points, 8);
  assert.equal(perf.possible_points, 10);
  assert.equal(perf.percent, 80);
});

test("no assessed results -> performance null", () => {
  const agg = aggregatePerformance([
    { assessed: false, assessable: true, percent: null },
    null,
  ]);
  assert.equal(agg.percent, null);
  assert.equal(agg.earned_points, null);
  assert.equal(agg.possible_points, null);
  assert.equal(agg.assessed, false);

  const learning = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId: {},
    engagementSegments: [],
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: null }),
  });
  assert.equal(learning.content.performance.percent, null);
  assert.equal(formatPerformanceDisplay(learning.content.performance), "Pendiente");
});

test("independent mutation: progress change does not alter performance", () => {
  const activityPerformance = resolveActivityPerformance({ maxPoints: 100, grade: 65 });
  const segments = [
    { target_id: "mat1", active_ms: 1000, unit_id: "u1", lesson_id: "l1" },
  ];
  const before = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId: { mat1: { status: ITEM_PROGRESS_STATUS.COMPLETED } },
    engagementSegments: segments,
    activityPerformance,
  });
  const afterProgress = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId: {
      mat1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
      quiz1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
      ex1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    },
    engagementSegments: segments,
    activityPerformance,
  });
  assert.notEqual(before.content.progress.percent, afterProgress.content.progress.percent);
  assert.equal(before.content.performance.percent, afterProgress.content.performance.percent);
  assert.equal(before.content.engagement.active_ms, afterProgress.content.engagement.active_ms);
});

test("independent mutation: engagement change does not alter progress or performance", () => {
  const activityPerformance = resolveActivityPerformance({ maxPoints: 100, grade: 65 });
  const progressByItemId = {
    mat1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    quiz1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    ex1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
  };
  const before = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId,
    engagementSegments: [{ target_id: "mat1", active_ms: 1000, unit_id: "u1", lesson_id: "l1" }],
    activityPerformance,
  });
  const after = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId,
    engagementSegments: [
      { target_id: "mat1", active_ms: 1000, unit_id: "u1", lesson_id: "l1" },
      { target_id: "quiz1", active_ms: 5000, unit_id: "u1", lesson_id: "l1" },
    ],
    activityPerformance,
  });
  assert.equal(before.content.progress.percent, after.content.progress.percent);
  assert.equal(before.content.performance.percent, after.content.performance.percent);
  assert.notEqual(before.content.engagement.active_ms, after.content.engagement.active_ms);
});

test("independent mutation: grade change does not alter progress", () => {
  const progressByItemId = {
    mat1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    quiz1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    ex1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
  };
  const segments = [{ target_id: "mat1", active_ms: 2000, unit_id: "u1", lesson_id: "l1" }];
  const before = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId,
    engagementSegments: segments,
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 65 }),
  });
  const after = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId,
    engagementSegments: segments,
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 90 }),
  });
  assert.equal(before.content.progress.percent, after.content.progress.percent);
  assert.equal(before.content.engagement.active_ms, after.content.engagement.active_ms);
  assert.notEqual(before.content.performance.percent, after.content.performance.percent);
});

test("parent aggregation does not double-count engagement segments", () => {
  const segments = [
    { target_id: "mat1", active_ms: 1000, unit_id: "u1", lesson_id: "l1" },
    { target_id: "mat1", active_ms: 500, unit_id: "u1", lesson_id: "l1" },
    { target_id: "quiz1", active_ms: 2000, unit_id: "u1", lesson_id: "l1" },
    { target_id: "lesson-doc:l1", active_ms: 300, unit_id: "u1", lesson_id: "l1" },
  ];
  const learning = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId: {},
    engagementSegments: segments,
  });
  // Same target segments sum once into parent (1000+500+2000+300 = 3800)
  assert.equal(learning.content.engagement.active_ms, 3800);
  assert.equal(learning.items.mat1.engagement.active_ms, 1500);
  assert.equal(learning.lessons.l1.engagement.active_ms, 3800);
  assert.equal(learning.units.u1.engagement.active_ms, 3800);
});

test("activity grade is not copied onto nested items", () => {
  const learning = deriveLearningStatusAggregates({
    snapshot,
    snapshotItems: items,
    progressByItemId: {
      quiz1: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    },
    engagementSegments: [{ target_id: "quiz1", active_ms: 7 * 60_000, unit_id: "u1", lesson_id: "l1" }],
    activityPerformance: resolveActivityPerformance({ maxPoints: 100, grade: 80 }),
  });
  assert.equal(learning.content.performance.percent, 80);
  assert.equal(learning.items.quiz1.progress.completed, true);
  assert.equal(learning.items.quiz1.engagement.active_ms, 7 * 60_000);
  // No per-item score source → unassessed / Pendiente, not 80
  assert.equal(learning.items.quiz1.performance?.percent ?? null, null);
  assert.equal(formatPerformanceDisplay(learning.items.quiz1.performance), "Pendiente");
  assert.equal(learning.items.mat1.performance, null);
  assert.equal(formatPerformanceDisplay(learning.items.mat1.performance), "—");
});

test("format helpers match teacher column examples", () => {
  // Teacher overview examples (Alumno | Progreso | Tiempo activo | Rendimiento):
  // Ana Perez | 100% | 4h 12m | 65%
  // Juan Lopez | 60% | 2h 05m | 90%
  // Lucia Gomez | 80% | 5h 01m | —
  assert.equal(formatActiveTime(4 * 3_600_000 + 12 * 60_000), "4h 12m");
  assert.equal(formatActiveTime(2 * 3_600_000 + 5 * 60_000), "2h 05m");
  assert.equal(formatActiveTime(5 * 3_600_000 + 1 * 60_000), "5h 01m");
  assert.equal(formatProgressDisplay({ percent: 100, emptyRequired: false }), "100%");
  assert.equal(formatProgressDisplay({ percent: 60, emptyRequired: false }), "60%");
  assert.equal(formatProgressDisplay({ percent: 80, emptyRequired: false }), "80%");
  assert.equal(formatPerformanceDisplay({ assessed: true, percent: 65 }), "65%");
  assert.equal(formatPerformanceDisplay({ assessed: true, percent: 90 }), "90%");
  assert.equal(formatPerformanceDisplay(null), "—");

  const ana = `Ana Perez | ${formatProgressDisplay({ percent: 100, emptyRequired: false })} | ${formatActiveTime(4 * 3_600_000 + 12 * 60_000)} | ${formatPerformanceDisplay({ assessed: true, percent: 65 })}`;
  const juan = `Juan Lopez | ${formatProgressDisplay({ percent: 60, emptyRequired: false })} | ${formatActiveTime(2 * 3_600_000 + 5 * 60_000)} | ${formatPerformanceDisplay({ assessed: true, percent: 90 })}`;
  const lucia = `Lucia Gomez | ${formatProgressDisplay({ percent: 80, emptyRequired: false })} | ${formatActiveTime(5 * 3_600_000 + 1 * 60_000)} | ${formatPerformanceDisplay(null)}`;
  assert.equal(ana, "Ana Perez | 100% | 4h 12m | 65%");
  assert.equal(juan, "Juan Lopez | 60% | 2h 05m | 90%");
  assert.equal(lucia, "Lucia Gomez | 80% | 5h 01m | —");
});

test("item read model exposes exact independent fields", () => {
  // Exact shape: progress: { status, required, completed }
  // engagement: { active_ms }
  // performance: { assessable, assessed, earned_points, possible_points, percent }
  const status = buildItemLearningStatus(items[1], {
    progressRow: { status: ITEM_PROGRESS_STATUS.COMPLETED },
    activeMs: 7 * 60_000,
    itemScore: { assessed: true, earned_points: 8, possible_points: 10 },
  });
  assert.deepEqual(Object.keys(status.progress).sort(), ["completed", "required", "status"]);
  assert.deepEqual(Object.keys(status.engagement), ["active_ms"]);
  assert.deepEqual(
    Object.keys(status.performance).sort(),
    ["assessable", "assessed", "earned_points", "percent", "possible_points"],
  );
  assert.equal(status.progress.status, ITEM_PROGRESS_STATUS.COMPLETED);
  assert.equal(status.progress.required, true);
  assert.equal(status.progress.completed, true);
  assert.equal(status.engagement.active_ms, 7 * 60_000);
  assert.equal(status.performance.assessable, true);
  assert.equal(status.performance.assessed, true);
  assert.equal(status.performance.earned_points, 8);
  assert.equal(status.performance.possible_points, 10);
  assert.equal(status.performance.percent, 80);
});

test("UI panel exposes Alumno | Progreso | Tiempo activo | Rendimiento", () => {
  const panel = readFileSync(
    resolve(root, "src/components/pybotclass/CourseContentProgressPanel.jsx"),
    "utf8",
  );
  assert.match(panel, /Alumno/);
  assert.match(panel, /Progreso/);
  assert.match(panel, /Tiempo activo/);
  assert.match(panel, /Rendimiento/);
  assert.match(panel, /fetchCourseLearningStatusOverview|buildStudentActivityLearningSummaries/);
});

test("student viewer shows Progreso · Tiempo activo · Rendimiento", () => {
  const viewer = readFileSync(
    resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
    "utf8",
  );
  assert.match(viewer, /Progreso:/);
  assert.match(viewer, /Tiempo activo:/);
  assert.match(viewer, /Rendimiento:/);
  assert.match(viewer, /learningStatus/);
});
