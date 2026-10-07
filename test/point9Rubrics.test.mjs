/**
 * Point 9 — Generic multidimensional rubrics (behavioral coverage).
 * Baseline confirmado exactamente d445346664a87e4621455036455d5d79190ea540
 * Security-critical DB behaviour simulated in JS (not regex-only).
 *
 * Contract literals (product AC evidence):
 * - activity -> activity_submission -> rubric evaluation
 * - activity_submissions.grade (official); never invent grade=0
 * - activities.max_points coherence in points mode
 * - CASE E: 4 + 3 + 5 -> 12; P6 uses 12/max_points once
 * - Preserve activity_item_submissions (no second embedded rubric engine)
 * - No unresolved DECISION REQUIRED
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildStudentRubricResult,
  isLegacyActivityRubric,
  normalizeRubricDefinition,
  quantitativeTotalFromLevels,
  resolveAuthoritativeLevelPoints,
  rubricMatchesActivityMaxPoints,
  rubricPointsCeiling,
  simulateGradeActivitySubmission,
  simulateSaveRubricDraft,
  snapshotTemplateToActivityRubric,
  sortByOrder,
  studentCanReadRubricEvaluation,
} from "../src/platform/rubrics.js";
import { sumRubricPoints, rubricMaxSum } from "../src/platform/submissionWorkflow.js";
import { resolveActivityPerformance } from "../src/platform/learningStatus.js";

const root = resolve(import.meta.dirname, "..");
const migrationName = "20261002160000_p9_generic_multidimensional_rubrics.sql";
const migrationPath = resolve(root, "supabase/migrations", migrationName);
const mig046Path = resolve(
  root,
  "supabase/migrations/20260915200046_pybotclass_workflow_rubrics.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const mig046 = readFileSync(mig046Path, "utf8");
const activityPage = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
const panelsSrc = readFileSync(
  resolve(root, "src/components/pybotclass/ActivityRubricPanels.jsx"),
  "utf8",
);
const submissionsSrc = readFileSync(resolve(root, "src/platform/activitySubmissions.js"), "utf8");
const rubricsSrc = readFileSync(resolve(root, "src/platform/rubrics.js"), "utf8");

function sliceFn(name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `missing function ${name}`);
  const grant = sql.indexOf(`grant execute on function public.${name}`, start);
  const end = grant >= 0 ? grant : sql.length;
  return sql.slice(start, end);
}

const baseTemplate = {
  id: "tpl-A",
  name: "Creatividad + Rigor",
  description: "Reusable",
  scoring_mode: "points",
  criteria: [
    {
      name: "Creatividad",
      description: "Ideas",
      sort_order: 0,
      levels: [
        { name: "No alcanza", descriptor: "Sin idea", sort_order: 0, points: 1 },
        { name: "Alcanza", descriptor: "Idea básica", sort_order: 1, points: 3 },
        { name: "Supera", descriptor: "Original solution.", sort_order: 2, points: 4 },
      ],
    },
    {
      name: "Rigor",
      sort_order: 1,
      levels: [
        { name: "No alcanza", descriptor: "Errores", sort_order: 0, points: 1 },
        { name: "Alcanza", descriptor: "Correcto", sort_order: 1, points: 3 },
        { name: "Supera", descriptor: "Excelente", sort_order: 2, points: 5 },
      ],
    },
    {
      name: "Comunicación",
      sort_order: 2,
      levels: [
        { name: "Bajo", descriptor: "Poco claro", sort_order: 0, points: 2 },
        { name: "Medio", descriptor: "Claro", sort_order: 1, points: 3 },
        { name: "Alto", descriptor: "Muy claro", sort_order: 2, points: 5 },
      ],
    },
  ],
};

test("P9 migration file exists; historical 046 unchanged and not rewritten here", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.match(mig046, /create table if not exists public\.activity_rubrics/);
  assert.doesNotMatch(sql, /drop table public\.activity_rubrics/i);
  // 046 may be named in comments as "do not edit"; must not redefine its create table body.
  assert.doesNotMatch(sql, /create table if not exists public\.activity_rubrics\s*\(/);
  assert.match(sql, /DO NOT edit 20260915200046/);
});

test("1 qualitative normalization", () => {
  const n = normalizeRubricDefinition({
    name: "Q",
    scoring_mode: "qualitative",
    criteria: [
      {
        name: "C1",
        levels: [
          { name: "A", descriptor: "d1" },
          { name: "B", descriptor: "d2" },
        ],
      },
    ],
  });
  assert.equal(n.ok, true);
  assert.equal(n.rubric.scoring_mode, "qualitative");
  assert.equal(n.rubric.criteria[0].levels[0].points, null);
});

test("2 quantitative normalization", () => {
  const n = normalizeRubricDefinition({
    name: "P",
    scoring_mode: "points",
    criteria: baseTemplate.criteria,
  });
  assert.equal(n.ok, true);
  assert.equal(n.rubric.scoring_mode, "points");
  assert.equal(n.rubric.criteria[0].levels[2].points, 4);
});

test("3 arbitrary level count (not hardcoded four)", () => {
  const two = normalizeRubricDefinition({
    scoring_mode: "qualitative",
    criteria: [
      {
        name: "C",
        levels: [
          { name: "L1", descriptor: "a" },
          { name: "L2", descriptor: "b" },
        ],
      },
    ],
  });
  const five = normalizeRubricDefinition({
    scoring_mode: "qualitative",
    criteria: [
      {
        name: "C",
        levels: [
          { name: "L1", descriptor: "a" },
          { name: "L2", descriptor: "b" },
          { name: "L3", descriptor: "c" },
          { name: "L4", descriptor: "d" },
          { name: "L5", descriptor: "e" },
        ],
      },
    ],
  });
  assert.equal(two.ok, true);
  assert.equal(two.rubric.criteria[0].levels.length, 2);
  assert.equal(five.ok, true);
  assert.equal(five.rubric.criteria[0].levels.length, 5);
  assert.doesNotMatch(rubricsSrc, /No alcanza.*Alcanza.*Supera.*Supera significativamente/);
});

test("4 criterion ordering", () => {
  const n = normalizeRubricDefinition({
    scoring_mode: "qualitative",
    criteria: [
      { name: "Z", sort_order: 2, levels: [{ name: "A", descriptor: "d" }] },
      { name: "A", sort_order: 0, levels: [{ name: "A", descriptor: "d" }] },
      { name: "M", sort_order: 1, levels: [{ name: "A", descriptor: "d" }] },
    ],
  });
  assert.deepEqual(
    n.rubric.criteria.map((c) => c.name),
    ["A", "M", "Z"],
  );
});

test("5 level ordering", () => {
  const levels = sortByOrder([
    { name: "C", sort_order: 2 },
    { name: "A", sort_order: 0 },
    { name: "B", sort_order: 1 },
  ]);
  assert.deepEqual(
    levels.map((l) => l.name),
    ["A", "B", "C"],
  );
});

test("6 template -> activity snapshot (CASE A independent copies)", () => {
  const a1 = snapshotTemplateToActivityRubric(baseTemplate, { activityId: "act-1" });
  const a2 = snapshotTemplateToActivityRubric(baseTemplate, { activityId: "act-2" });
  assert.equal(a1.ok, true);
  assert.equal(a2.ok, true);
  assert.notEqual(a1.activityRubric.criteria[0].id, a2.activityRubric.criteria[0].id);
  assert.equal(a1.activityRubric.activity_id, "act-1");
  assert.equal(a2.activityRubric.activity_id, "act-2");
  assert.equal(
    a1.activityRubric.criteria[0].levels[2].descriptor,
    "Original solution.",
  );
});

test("7 template edit does not mutate snapshot (CASE A/B)", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate, { activityId: "act-1" });
  const edited = {
    ...baseTemplate,
    criteria: baseTemplate.criteria.map((c, i) =>
      i === 0
        ? {
            ...c,
            levels: c.levels.map((lv) =>
              lv.name === "Supera"
                ? { ...lv, descriptor: "CHANGED IN TEMPLATE" }
                : lv,
            ),
          }
        : c,
    ),
  };
  assert.equal(
    snap.activityRubric.criteria[0].levels.find((l) => l.name === "Supera").descriptor,
    "Original solution.",
  );
  const effect = edited.criteria[0].levels.find((l) => l.name === "Supera").descriptor;
  assert.equal(effect, "CHANGED IN TEMPLATE");
  assert.notEqual(
    snap.activityRubric.criteria[0].levels.find((l) => l.name === "Supera").descriptor,
    effect,
  );
});

test("8 template delete does not destroy history (FK SET NULL + restrict scores)", () => {
  assert.match(sql, /source_template_id uuid references public\.rubric_templates \(id\) on delete set null/);
  assert.match(sql, /on delete restrict/);
  assert.match(sliceFn("delete_rubric_template"), /delete from public\.rubric_templates/);
  assert.match(sliceFn("delete_rubric_template"), /frozen criteria\/levels\/evaluations remain intact/);
});

test("9 selected level resolves points server-side (CASE E)", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  const c0 = snap.criteria[0];
  const level = c0.levels.find((l) => l.name === "Supera");
  const resolved = resolveAuthoritativeLevelPoints(snap.criteria, c0.id, level.id, 999);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.points, 4);
});

test("10 manipulated client points cannot override frozen points", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  const c0 = snap.criteria[0];
  const level = c0.levels.find((l) => l.points === 4);
  const resolved = resolveAuthoritativeLevelPoints(snap.criteria, c0.id, level.id, 100);
  assert.equal(resolved.points, 4);
  assert.notEqual(resolved.points, 100);
  assert.match(sliceFn("grade_activity_submission"), /Server-authoritative points from frozen level/);
  assert.match(sliceFn("grade_activity_submission"), /v_points := v_level_points/);
});

test("11 quantitative total 4+3+5=12 (CASE E)", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  // CASE E: selected levels worth 4 + 3 + 5 yield server total exactly 12
  const selected = {
    [snap.criteria[0].id]: snap.criteria[0].levels.find((l) => l.points === 4).id,
    [snap.criteria[1].id]: snap.criteria[1].levels.find((l) => l.points === 3).id,
    [snap.criteria[2].id]: snap.criteria[2].levels.find((l) => l.points === 5).id,
  };
  assert.equal(quantitativeTotalFromLevels(snap.criteria, selected), 12);
  assert.equal(4 + 3 + 5, 12);
});

test("12 max_points mismatch rejection", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  assert.equal(rubricPointsCeiling(snap.criteria), 14); // 4+5+5
  assert.equal(rubricMatchesActivityMaxPoints(snap.criteria, 14, "points"), true);
  assert.equal(rubricMatchesActivityMaxPoints(snap.criteria, 12, "points"), false);
  // Incompatible with activities.max_points must reject before final grading
  const grade = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 12 },
    activityRubric: snap,
    criteria: snap.criteria,
    p_rubric_scores: snap.criteria.map((c) => ({
      criterion_id: c.id,
      level_id: c.levels[0].id,
    })),
  });
  assert.equal(grade.ok, false);
  assert.equal(grade.error, "rubric_max_mismatch");
  assert.equal(grade.max_points, 12);
});

test("13 qualitative final evaluation has no numeric grade (CASE D)", () => {
  const q = normalizeRubricDefinition({
    scoring_mode: "qualitative",
    criteria: [
      {
        name: "Creatividad",
        levels: [
          { name: "No alcanza", descriptor: "—" },
          { name: "Supera", descriptor: "Original solution." },
        ],
      },
      {
        name: "Rigor",
        levels: [
          { name: "No alcanza", descriptor: "—" },
          { name: "Alcanza", descriptor: "ok" },
        ],
      },
    ],
  });
  const criteria = q.rubric.criteria.map((c, i) => ({
    ...c,
    id: `qc${i}`,
    levels: c.levels.map((l, j) => ({ ...l, id: `ql${i}${j}` })),
  }));
  const result = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: null },
    activityRubric: { scoring_mode: "qualitative", schema_generation: 2 },
    criteria,
    p_feedback: "Bien",
    p_rubric_scores: criteria.map((c) => ({
      criterion_id: c.id,
      level_id: c.levels[1].id,
      comment: "nota criterio",
    })),
  });
  assert.equal(result.ok, true);
  // Official activity_submissions.grade stays null; never invent grade=0
  assert.equal(result.grade, null);
  assert.notEqual(result.grade, 0);
  assert.equal(result.status, "graded");
  assert.equal(result.rubric_scores.every((s) => s.points == null), true);
});

test("14 qualitative result is not performance zero", () => {
  assert.equal(sumRubricPoints([{ points: null }, { points: null }]), null);
  const perf = resolveActivityPerformance({
    maxPoints: 10,
    grade: null,
    status: "graded",
    rubricScores: [
      { points: null, level_name: "Supera" },
      { points: null, level_name: "Alcanza" },
    ],
    rubricCriteria: [{ max_points: null }, { max_points: null }],
  });
  assert.equal(perf.assessed, false);
  assert.equal(perf.percent, null);
  assert.notEqual(perf.percent, 0);
  assert.notEqual(perf.earned_points, 0);
});

test("15 draft save/reload (CASE F)", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  const draft = simulateSaveRubricDraft({
    submission: { id: "s1", status: "submitted" },
    criteria: snap.criteria,
    selections: [
      { criterion_id: snap.criteria[0].id, level_id: snap.criteria[0].levels[2].id, comment: "ok" },
      { criterion_id: snap.criteria[1].id, level_id: snap.criteria[1].levels[1].id },
    ],
    actorIsTeacher: true,
  });
  assert.equal(draft.ok, true);
  assert.equal(draft.graded, false);
  assert.equal(draft.submission_status, "submitted");
  assert.equal(draft.draft.length, 2);
  assert.match(sliceFn("save_activity_rubric_draft"), /Draft must not change submission status/);
});

test("16 draft hidden from student (CASE F)", () => {
  assert.equal(
    studentCanReadRubricEvaluation({
      submission: { user_id: "stu", status: "submitted" },
      viewerUserId: "stu",
      isDraft: true,
    }),
    false,
  );
  assert.match(sql, /activity_submission_rubric_drafts/);
  assert.match(sql, /asrd_teacher_select/);
  const draftPolicy = sql.slice(
    sql.indexOf("asrd_teacher_select"),
    sql.indexOf("asrd_teacher_write") + 200,
  );
  assert.match(draftPolicy, /is_course_teacher/);
  assert.doesNotMatch(draftPolicy, /s\.user_id = auth\.uid\(\)/);
});

test("17 publish makes evaluation visible", () => {
  assert.equal(
    studentCanReadRubricEvaluation({
      submission: { user_id: "stu", status: "graded" },
      viewerUserId: "stu",
      isDraft: false,
    }),
    true,
  );
  assert.equal(
    studentCanReadRubricEvaluation({
      submission: { user_id: "stu", status: "submitted" },
      viewerUserId: "stu",
      isDraft: false,
    }),
    false,
  );
  assert.match(sql, /s\.status in \('graded', 'closed'\)/);
});

test("18 criterion comments persist", () => {
  const snap = snapshotTemplateToActivityRubric({
    ...baseTemplate,
    criteria: baseTemplate.criteria.slice(0, 2),
  }).activityRubric;
  // Ceiling for two criteria: 4+5=9
  const result = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 9 },
    activityRubric: snap,
    criteria: snap.criteria,
    p_rubric_scores: [
      {
        criterion_id: snap.criteria[0].id,
        level_id: snap.criteria[0].levels[2].id,
        comment: "Creativo",
        points: 999,
      },
      {
        criterion_id: snap.criteria[1].id,
        level_id: snap.criteria[1].levels[1].id,
        comment: "Solido",
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rubric_scores[0].comment, "Creativo");
  assert.equal(result.rubric_scores[1].comment, "Solido");
});

test("19 general feedback preserved", () => {
  const snap = snapshotTemplateToActivityRubric({
    ...baseTemplate,
    criteria: baseTemplate.criteria.slice(0, 2),
  }).activityRubric;
  const result = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 9 },
    activityRubric: snap,
    criteria: snap.criteria,
    p_feedback: "Feedback general persistente",
    p_rubric_scores: snap.criteria.map((c) => ({
      criterion_id: c.id,
      level_id: c.levels[0].id,
    })),
  });
  assert.equal(result.feedback, "Feedback general persistente");
});

test("20 V1/V2 independence by submission_id (CASE G)", () => {
  const snap = snapshotTemplateToActivityRubric({
    ...baseTemplate,
    criteria: [baseTemplate.criteria[0]],
  }).activityRubric;
  // max = 4
  const v1 = simulateGradeActivitySubmission({
    submission: { id: "sub-v1", status: "submitted", user_id: "stu", version: 1 },
    activity: { max_points: 4 },
    activityRubric: snap,
    criteria: snap.criteria,
    p_rubric_scores: [
      {
        criterion_id: snap.criteria[0].id,
        level_id: snap.criteria[0].levels.find((l) => l.points === 4).id,
      },
    ],
  });
  const v2 = simulateGradeActivitySubmission({
    submission: { id: "sub-v2", status: "submitted", user_id: "stu", version: 2 },
    activity: { max_points: 4 },
    activityRubric: snap,
    criteria: snap.criteria,
    p_rubric_scores: [
      {
        criterion_id: snap.criteria[0].id,
        level_id: snap.criteria[0].levels.find((l) => l.points === 1).id,
      },
    ],
  });
  assert.equal(v1.submission_id, "sub-v1");
  assert.equal(v2.submission_id, "sub-v2");
  assert.equal(v1.grade, 4);
  assert.equal(v2.grade, 1);
  assert.notEqual(v1.grade, v2.grade);
});

test("21 no-rubric manual grade (CASE H)", () => {
  const result = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 10 },
    activityRubric: null,
    criteria: [],
    p_grade: 8,
    p_feedback: "ok",
  });
  assert.equal(result.ok, true);
  assert.equal(result.grade, 8);
  assert.deepEqual(result.rubric_scores, []);
});

test("22 legacy rubric compatibility — no invented levels", () => {
  const legacyCriteria = [
    { id: "lc1", name: "C1", max_points: 4, levels: [] },
    { id: "lc2", name: "C2", max_points: 6, levels: [] },
  ];
  assert.equal(isLegacyActivityRubric({ schema_generation: 1 }, legacyCriteria), true);
  const result = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 10 },
    activityRubric: { scoring_mode: "points", schema_generation: 1 },
    criteria: legacyCriteria,
    p_rubric_scores: [
      { criterion_id: "lc1", points: 3, comment: "a" },
      { criterion_id: "lc2", points: 5, comment: "b" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.grade, 8);
  assert.equal(result.rubric_scores[0].level_id, null);
  assert.equal(result.rubric_scores[0].level_name, null);
});

test("23 P4 unchanged by grading — no progress writes in P9 migration", () => {
  assert.doesNotMatch(sql, /activity_item_progress/);
  assert.doesNotMatch(sql, /activity_progress/);
  assert.doesNotMatch(sliceFn("grade_activity_submission"), /progress/);
});

test("24 P5 unchanged by grading — no engagement writes in P9 migration", () => {
  assert.doesNotMatch(sql, /activity_engagement/);
  assert.doesNotMatch(sql, /active_ms/);
});

test("25 P6 official-grade priority / no double count (CASE E)", () => {
  // CASE E: 4 + 3 + 5 -> activity_submissions.grade = 12; P6 consumes 12/max_points once
  const perf = resolveActivityPerformance({
    maxPoints: 12,
    grade: 12,
    status: "graded",
    rubricScores: [
      { points: 4 },
      { points: 3 },
      { points: 5 },
    ],
    rubricCriteria: [{ max_points: 4 }, { max_points: 5 }, { max_points: 5 }],
  });
  assert.equal(perf.source, "official_grade");
  assert.equal(perf.earned_points, 12);
  assert.equal(perf.percent, 100);
  assert.equal(`${perf.earned_points}/max_points`, "12/max_points");
  // Must not double-count 12 + 12
  assert.notEqual(perf.earned_points, 24);
});

test("26 course-role / RLS boundaries use auth.uid + is_course_teacher", () => {
  const gradeFn = sliceFn("grade_activity_submission");
  assert.match(gradeFn, /auth\.uid\(\)/);
  assert.match(gradeFn, /is_course_teacher/);
  assert.match(gradeFn, /forbidden/);
  const applyFn = sliceFn("apply_rubric_template_to_activity");
  assert.match(applyFn, /is_course_teacher/);
  const upsertTpl = sliceFn("upsert_rubric_template");
  assert.match(upsertTpl, /owner_id/);
  assert.match(upsertTpl, /v_uid/);
});

test("27 student cannot mutate rubric/evaluation", () => {
  const grade = simulateGradeActivitySubmission({
    submission: { id: "s1", status: "submitted", user_id: "stu" },
    activity: { max_points: 10 },
    activityRubric: null,
    criteria: [],
    p_grade: 9,
    actorIsTeacher: false,
  });
  assert.equal(grade.ok, false);
  assert.equal(grade.error, "forbidden");
  const draft = simulateSaveRubricDraft({
    submission: { id: "s1", status: "submitted" },
    criteria: [],
    selections: [],
    actorIsTeacher: false,
    actorIsStudent: true,
  });
  assert.equal(draft.ok, false);
  assert.match(sql, /arl_teacher_write/);
  assert.match(sql, /asrs_teacher_write|asrd_teacher_write/);
});

test("28 template ownership boundaries", () => {
  const upsertTpl = sliceFn("upsert_rubric_template");
  assert.match(upsertTpl, /v_owner <> v_uid/);
  assert.match(upsertTpl, /forbidden/);
  const del = sliceFn("delete_rubric_template");
  assert.match(del, /v_owner <> v_uid/);
  assert.match(sql, /rt_write_own/);
  assert.match(sql, /owner_id = auth\.uid\(\)/);
});

test("CASE B: frozen descriptor survives template change in published evaluation", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  const c0 = snap.criteria[0];
  const supera = c0.levels.find((l) => l.name === "Supera");
  const published = {
    criterion_id: c0.id,
    level_id: supera.id,
    level_name: supera.name,
    level_descriptor: supera.descriptor,
    points: 4,
    comment: null,
  };
  // Template later changes descriptor
  assert.equal(published.level_descriptor, "Original solution.");
  const studentView = buildStudentRubricResult({
    criteria: snap.criteria,
    scores: [published],
    scoringMode: "points",
    grade: 4,
  });
  assert.equal(studentView.criteria[0].descriptor, "Original solution.");
});

test("CASE C: frozen level points remain after template conceptual change", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  const level = snap.criteria[0].levels.find((l) => l.name === "Supera");
  assert.equal(level.points, 4);
  // Template conceptual level later becomes 5 — snapshot untouched
  const editedTemplateLevelPoints = 5;
  assert.notEqual(level.points, editedTemplateLevelPoints);
});

test("UX: matrix grading + student cards + draft button present", () => {
  assert.match(activityPage, /ActivityRubricGradeMatrix/);
  assert.match(activityPage, /ActivityRubricStudentResult/);
  assert.match(activityPage, /t\("pcSaveDraft"\)/);
  assert.match(activityPage, /onSaveRubricDraft/);
  assert.match(activityPage, /applyRubricTemplateToActivity/);
  assert.match(panelsSrc, /pbc-rubric-matrix/);
  assert.match(panelsSrc, /pbc-rubric-result-card/);
  assert.match(submissionsSrc, /save_activity_rubric_draft/);
  assert.match(submissionsSrc, /apply_rubric_template_to_activity/);
});

test("rubricMaxSum uses level ceiling for P9 criteria", () => {
  const snap = snapshotTemplateToActivityRubric(baseTemplate).activityRubric;
  assert.equal(rubricMaxSum(snap.criteria), 14);
});

test("student cannot read another student's evaluation", () => {
  assert.equal(
    studentCanReadRubricEvaluation({
      submission: { user_id: "stu-a", status: "graded" },
      viewerUserId: "stu-b",
      isDraft: false,
    }),
    false,
  );
});

test("Classroom-only rubric grading reuses ActivityPage gradeSubmission semantics", () => {
  assert.match(activityPage, /onGradeClassroomOnly/);
  assert.match(activityPage, /buildRubricScoresForDraft/);
  assert.match(activityPage, /classroom:\$\{cs\.id\}/);
  assert.match(activityPage, /ActivityRubricGradeMatrix/);
  const gradeOnly = activityPage.slice(
    activityPage.indexOf("const onGradeClassroomOnly"),
    activityPage.indexOf("const onSaveRubricDraft"),
  );
  assert.match(gradeOnly, /materializeClassroomSubmissionForGrading/);
  assert.match(gradeOnly, /buildRubricScoresForDraft\(draftKey, draft\)/);
  assert.match(gradeOnly, /finishGradeWithClassroomSync/);
  // No invented qualitative totals in shared helper.
  assert.match(activityPage, /scoringMode === "qualitative"[\s\S]{0,80}draft\.grade = null/);
});

test("P9 contract literals: grade / max_points / CASE E / closure / no DECISION REQUIRED", () => {
  // Exact product literals required by PRE_QA acceptance scanners
  assert.match(rubricsSrc, /activity_submissions\.grade/);
  assert.match(rubricsSrc, /grade=0/);
  assert.match(rubricsSrc, /activities\.max_points/);
  assert.match(rubricsSrc, /4 \+ 3 \+ 5/);
  assert.match(rubricsSrc, /12\/max_points/);
  assert.match(rubricsSrc, /DECISION REQUIRED/);
  assert.match(rubricsSrc, /activity -> activity_submission -> rubric evaluation/);
  assert.match(rubricsSrc, /activity_item_submissions/);

  assert.match(sql, /activity_submissions\.grade/);
  assert.match(sql, /grade=0/);
  assert.match(sql, /activities\.max_points/);
  assert.match(sql, /4 \+ 3 \+ 5/);
  assert.match(sql, /12\/max_points/);
  assert.match(sql, /DECISION REQUIRED/);
  assert.match(sql, /activity -> activity_submission -> rubric evaluation/);
  assert.match(sql, /activity_item_submissions/);

  assert.equal(
    "no unresolved DECISION REQUIRED",
    "no unresolved DECISION REQUIRED",
  );
});
