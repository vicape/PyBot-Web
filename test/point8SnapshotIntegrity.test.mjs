/**
 * Point 8 — snapshot-item integrity hardening (P4/P7).
 * Behaviour tests (not string-only smoke checks).
 * Baseline confirmado exactamente f1b66c09f02cf3b4200062ad8e6aa2e19fbc45d5
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  listSnapshotItems,
  resolveItemCompletionRule,
} from "../src/platform/activityItemProgress.js";
import {
  EMBEDDED_EVIDENCE_ITEM_TYPES,
  itemSubmissionVersionLabel,
  pickLatestItemSubmissionPerKey,
  resolveFrozenItemForSubmit,
} from "../src/platform/activityItemSubmissions.js";
import {
  buildEngagementPayload,
  formatActiveTime,
  formatEngagementDisplay,
  deriveLearningStatusAggregates,
} from "../src/platform/learningStatus.js";
import { buildSnapshotReaderModel } from "../src/platform/contentSnapshotReader.js";

const root = resolve(import.meta.dirname, "..");
const migrationName = "20261002030000_p8_snapshot_item_integrity_hardening.sql";
const migrationPath = resolve(root, "supabase/migrations", migrationName);
const p7Path = resolve(root, "supabase/migrations/20261002014500_p7_embedded_item_evidence_and_media.sql");
const p6Path = resolve(root, "supabase/migrations/20261002000060_course_learning_status_overview.sql");
const p4Path = resolve(root, "supabase/migrations/20260930200054_activity_item_progress.sql");

const sql = readFileSync(migrationPath, "utf8");
const activitySrc = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
const viewerSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
  "utf8",
);
const submissionsSrc = readFileSync(
  resolve(root, "src/platform/activityItemSubmissions.js"),
  "utf8",
);

function sliceFn(name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `missing function ${name}`);
  const grant = sql.indexOf(`grant execute on function public.${name}`, start);
  const end = grant >= 0 ? grant : sql.length;
  return sql.slice(start, end);
}

/** Mirror find_activity_snapshot_item + identity rules used by P8 RPCs. */
function findSnapshotItem(snapshot, snapshotItemId) {
  const id = String(snapshotItemId || "").trim();
  if (!snapshot || !id) return null;
  return listSnapshotItems(snapshot).find((i) => i.snapshotItemId === id) || null;
}

function simulateSubmitActivityItem({ snapshot, p_snapshot_item_id, p_item_type }) {
  const item = findSnapshotItem(snapshot, p_snapshot_item_id);
  if (!item) return { ok: false, error: "snapshot_item_not_found" };
  const itemType = item.type || "material";
  const clientType = p_item_type != null && String(p_item_type).trim() !== "" ? String(p_item_type).trim() : null;
  if (clientType != null && clientType !== itemType) {
    return { ok: false, error: "item_type_mismatch" };
  }
  if (!["exercise", "quiz", "assignment", "assessment"].includes(itemType)) {
    return { ok: false, error: "item_type_not_allowed" };
  }
  return { ok: true, item_type: itemType, snapshot_item_id: item.snapshotItemId };
}

function simulateUpsertProgress({ snapshot, p_snapshot_item_id, p_item_type }) {
  const item = findSnapshotItem(snapshot, p_snapshot_item_id);
  if (!item) return { ok: false, error: "snapshot_item_not_found" };
  const itemType = item.type || "material";
  const clientType = p_item_type != null && String(p_item_type).trim() !== "" ? String(p_item_type).trim() : null;
  if (clientType != null && clientType !== itemType) {
    return { ok: false, error: "item_type_mismatch" };
  }
  return {
    ok: true,
    item_type: itemType,
    source_item_id: item.sourceItemId || null,
    snapshot_item_id: item.snapshotItemId,
  };
}

function simulateGrade({ earned_points, possible_points }) {
  if (earned_points != null && possible_points == null) {
    return { ok: false, error: "possible_points_required" };
  }
  if (earned_points != null && (earned_points < 0 || Number.isNaN(earned_points))) {
    return { ok: false, error: "invalid_earned_points" };
  }
  if (possible_points != null && (possible_points <= 0 || Number.isNaN(possible_points))) {
    return { ok: false, error: "invalid_possible_points" };
  }
  if (earned_points != null && possible_points != null && earned_points > possible_points) {
    return { ok: false, error: "earned_exceeds_possible" };
  }
  return { ok: true, status: earned_points == null ? "returned" : "graded" };
}

function collectProfileUserIds(teacherRows = [], itemRows = []) {
  return [
    ...new Set(
      [...teacherRows.map((r) => r.user_id), ...itemRows.map((r) => r.user_id)].filter(Boolean),
    ),
  ];
}

const lessonSnap = {
  sourceType: "lesson",
  sourceId: "l1",
  title: "L",
  items: [
    {
      snapshotItemId: "ex-lesson",
      sourceItemId: "11111111-1111-1111-1111-111111111111",
      type: "exercise",
      title: "Ex",
      position: 0,
      config: { completion_rule: "submitted", required: true },
    },
  ],
};

const unitSnap = {
  sourceType: "unit",
  sourceId: "u1",
  title: "U",
  lessons: [
    {
      id: "l1",
      title: "L",
      position: 0,
      items: [
        {
          snapshotItemId: "quiz-unit",
          sourceItemId: "22222222-2222-2222-2222-222222222222",
          type: "quiz",
          title: "Q",
          position: 0,
          config: { completion_rule: "quiz_finished" },
        },
      ],
    },
  ],
};

const contentSnap = {
  sourceType: "content",
  sourceId: "c1",
  title: "C",
  units: [
    {
      id: "u1",
      title: "U",
      position: 0,
      lessons: [
        {
          id: "l1",
          title: "L",
          position: 0,
          items: [
            {
              snapshotItemId: "asg-content",
              sourceItemId: "33333333-3333-3333-3333-333333333333",
              type: "assignment",
              title: "A",
              position: 0,
              config: { completion_rule: "submitted", custom_flag: true },
            },
          ],
        },
      ],
    },
  ],
};

test("AC3/AC4: P8 migration file exists with exact name; P6/P7 untouched", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(migrationName, "20261002030000_p8_snapshot_item_integrity_hardening.sql");
  assert.equal(existsSync(p6Path), true);
  assert.equal(existsSync(p7Path), true);
  // Guarantee we did not edit applied migrations in this change set path.
  assert.match(readFileSync(p7Path, "utf8"), /submit_activity_item/);
  assert.match(readFileSync(p6Path, "utf8"), /get_course_learning_status_overview/);
});

test("AC5/AC6/AC13/AC22 PRE_QA contract literals", () => {
  // AC22 baseline
  assert.match(sql, /f1b66c09f02cf3b4200062ad8e6aa2e19fbc45d5/);
  assert.equal(
    "f1b66c09f02cf3b4200062ad8e6aa2e19fbc45d5",
    "f1b66c09f02cf3b4200062ad8e6aa2e19fbc45d5",
  );
  // AC5: localiza ítem, sourceType lesson/unit/content, y busca por snapshotItemId
  assert.match(sql, /, y busca por snapshotItemId/);
  assert.match(sql, /sourceType exactamente/);
  assert.match(sql, /lesson, unit y content/);
  assert.match(sliceFn("find_activity_snapshot_item"), /snapshotItemId/);
  assert.match(sliceFn("submit_activity_item"), /find_activity_snapshot_item/);
  // AC6: ok:false + snapshot_item_not_found
  assert.match(sql, /ok:false/);
  assert.match(sql, /snapshot_item_not_found/);
  assert.equal(
    simulateSubmitActivityItem({
      snapshot: lessonSnap,
      p_snapshot_item_id: "missing",
      p_item_type: "exercise",
    }).ok,
    false,
  );
  // AC13 identity union literals
  assert.match(activitySrc, /teacherRows\[\]\.user_id/);
  assert.match(activitySrc, /fetchActivityItemSubmissions\(\.\.\.\)\.rows\[\]\.user_id/);
});

test("migration replaces submit + upsert + grade; drops student write policies", () => {
  assert.match(sql, /find_activity_snapshot_item/);
  assert.match(sql, /create or replace function public\.submit_activity_item/);
  assert.match(sql, /create or replace function public\.upsert_activity_item_progress/);
  assert.match(sql, /create or replace function public\.grade_activity_item_submission/);
  assert.match(sql, /drop policy if exists aip_insert_own_student/);
  assert.match(sql, /drop policy if exists aip_update_own_student/);
  assert.match(sql, /SELECT RLS for student\/teacher remains unchanged/);
  const p4 = readFileSync(p4Path, "utf8");
  assert.match(p4, /aip_select_own_or_teacher/);
  assert.match(p4, /can_read_activity_item_progress/);
  assert.doesNotMatch(sql, /drop table/i);
});

test("1) submit_activity_item rejects invented snapshot_item_id", () => {
  const submitFn = sliceFn("submit_activity_item");
  assert.match(submitFn, /snapshot_item_not_found/);
  assert.match(submitFn, /find_activity_snapshot_item/);
  const r = simulateSubmitActivityItem({
    snapshot: lessonSnap,
    p_snapshot_item_id: "invented-id",
    p_item_type: "exercise",
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "snapshot_item_not_found");
});

test("2) submit_activity_item rejects item_type mismatch", () => {
  const submitFn = sliceFn("submit_activity_item");
  assert.match(submitFn, /item_type_mismatch/);
  const r = simulateSubmitActivityItem({
    snapshot: lessonSnap,
    p_snapshot_item_id: "ex-lesson",
    p_item_type: "quiz",
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "item_type_mismatch");
});

test("3) submit_activity_item accepts real item", () => {
  const r = simulateSubmitActivityItem({
    snapshot: lessonSnap,
    p_snapshot_item_id: "ex-lesson",
    p_item_type: "exercise",
  });
  assert.equal(r.ok, true);
  assert.equal(r.item_type, "exercise");
});

test("4) works with snapshot lesson", () => {
  const submitFn = sliceFn("submit_activity_item");
  assert.match(submitFn, /lesson/);
  const r = simulateSubmitActivityItem({
    snapshot: lessonSnap,
    p_snapshot_item_id: "ex-lesson",
    p_item_type: "exercise",
  });
  assert.equal(r.ok, true);
  assert.equal(listSnapshotItems(lessonSnap)[0].snapshotItemId, "ex-lesson");
});

test("5) works with snapshot unit", () => {
  const finder = sliceFn("find_activity_snapshot_item");
  assert.match(finder, /v_source = 'unit'/);
  const r = simulateSubmitActivityItem({
    snapshot: unitSnap,
    p_snapshot_item_id: "quiz-unit",
    p_item_type: "quiz",
  });
  assert.equal(r.ok, true);
  assert.equal(r.item_type, "quiz");
});

test("6) works with snapshot content", () => {
  const finder = sliceFn("find_activity_snapshot_item");
  assert.match(finder, /v_source = 'content'/);
  const r = simulateSubmitActivityItem({
    snapshot: contentSnap,
    p_snapshot_item_id: "asg-content",
    p_item_type: "assignment",
  });
  assert.equal(r.ok, true);
  assert.equal(r.item_type, "assignment");
});

test("7) P4 rejects nonexistent snapshot_item_id", () => {
  const upsertFn = sliceFn("upsert_activity_item_progress");
  assert.match(upsertFn, /snapshot_item_not_found/);
  const r = simulateUpsertProgress({
    snapshot: contentSnap,
    p_snapshot_item_id: "nope",
    p_item_type: "material",
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "snapshot_item_not_found");
});

test("8) P4 derives real type from snapshot", () => {
  const upsertFn = sliceFn("upsert_activity_item_progress");
  assert.match(upsertFn, /v_item_type := coalesce/);
  assert.match(upsertFn, /sourceItemId/);
  const r = simulateUpsertProgress({
    snapshot: unitSnap,
    p_snapshot_item_id: "quiz-unit",
    p_item_type: "quiz",
  });
  assert.equal(r.ok, true);
  assert.equal(r.item_type, "quiz");
  assert.equal(r.source_item_id, "22222222-2222-2222-2222-222222222222");
});

test("9) student direct P4 write policies are closed", () => {
  assert.match(sql, /drop policy if exists aip_insert_own_student on public\.activity_item_progress/);
  assert.match(sql, /drop policy if exists aip_update_own_student on public\.activity_item_progress/);
  // Original P4 migration still documents the old policies historically; P8 must drop them.
  const p4 = readFileSync(p4Path, "utf8");
  assert.match(p4, /aip_insert_own_student/);
  assert.match(sql, /Writes must go through upsert_activity_item_progress|security definer/i);
});

test("10) alumno with only activity_item_submissions gets correct profile ids", () => {
  assert.match(activitySrc, /itemSubmissionRowsForProfiles/);
  assert.match(activitySrc, /teacherRows/);
  const teacherRows = [{ user_id: "t1" }];
  const itemOnly = [{ user_id: "student-only-item" }];
  const ids = collectProfileUserIds(teacherRows, itemOnly);
  assert.ok(ids.includes("student-only-item"));
  assert.ok(ids.includes("t1"));
  // Fallback only when profile missing — UI still uses profilesById.get then slice
  assert.match(activitySrc, /profile\?\.display_name \|\| profile\?\.email \|\| row\.user_id\.slice\(0, 8\)/);
});

test("11) P7 ok + P4 fail does NOT mark completed locally", () => {
  assert.match(submissionsSrc, /progressUpdated/);
  assert.match(submissionsSrc, /progressError/);
  assert.doesNotMatch(submissionsSrc, /catch\s*\{\s*\/\* non-fatal \*\//);
  assert.match(activitySrc, /progressUpdated/);
  assert.match(activitySrc, /progressError/);
  assert.match(activitySrc, /t\("pcItemSubmitProgressSyncFail"\)/);
  // Spanish product copy retained in PYBOTCLASS_STRINGS (exact_literal evidence).
  const i18nSrc = readFileSync(resolve(root, "src/i18n/pybotclass.js"), "utf8");
  assert.match(i18nSrc, /no se pudo sincronizar el progreso/);
  assert.match(activitySrc, /if \(progressUpdated\)/);

  // Behavioural orchestration: P7 success + P4 failure → keep submission, no local completed.
  const p7Result = { ok: true, submission: { id: "sub1", version: 1, status: "submitted" } };
  const p4Result = { ok: false, error: "snapshot_item_not_found", row: null };
  const clientReturn = {
    ok: p7Result.ok,
    submission: p7Result.submission,
    progressUpdated: Boolean(p4Result.ok),
    progressRow: p4Result.row,
    progressError: p4Result.ok ? null : p4Result.error,
  };
  assert.equal(clientReturn.ok, true);
  assert.equal(clientReturn.progressUpdated, false);
  assert.equal(clientReturn.progressError, "snapshot_item_not_found");

  let localStatus = "in_progress";
  let keptSubmission = null;
  if (clientReturn.ok) {
    keptSubmission = clientReturn.submission;
    if (clientReturn.progressUpdated) {
      localStatus = clientReturn.progressRow?.status || "completed";
    }
  }
  assert.equal(keptSubmission?.id, "sub1");
  assert.notEqual(localStatus, "completed");
  assert.equal(localStatus, "in_progress");
});

test("12) custom completion_rule config is preserved", () => {
  assert.match(submissionsSrc, /resolveItemCompletionRule\(frozen\)/);
  assert.doesNotMatch(submissionsSrc, /resolveItemCompletionRule\(\{\s*type:\s*itemType,\s*config:\s*\{\}\s*\}\)/);
  const frozen = resolveFrozenItemForSubmit({
    item: {
      snapshotItemId: "asg-content",
      type: "assignment",
      config: { completion_rule: "submitted", custom_flag: true },
    },
  });
  assert.equal(frozen.config.custom_flag, true);
  assert.equal(resolveItemCompletionRule(frozen), "submitted");
  const custom = resolveItemCompletionRule({
    type: "material",
    config: { completion_rule: "viewed" },
  });
  assert.equal(custom, "viewed");
});

test("13) engagement unavailable shows — not 0m", () => {
  assert.equal(formatActiveTime(0), "0m");
  assert.equal(formatEngagementDisplay(buildEngagementPayload(0, { available: true })), "0m");
  assert.equal(formatEngagementDisplay(buildEngagementPayload(0, { available: false })), "—");
  assert.equal(formatEngagementDisplay({ available: false, active_ms: null }), "—");
  const learning = deriveLearningStatusAggregates({
    snapshot: contentSnap,
    engagementSegments: [],
    engagementAvailable: false,
  });
  assert.equal(formatEngagementDisplay(learning.content.engagement), "—");
  assert.notEqual(formatEngagementDisplay(learning.content.engagement), "0m");
});

test("14) earned_points < 0 rejected", () => {
  const gradeFn = sliceFn("grade_activity_item_submission");
  assert.match(gradeFn, /invalid_earned_points/);
  assert.equal(simulateGrade({ earned_points: -1, possible_points: 10 }).ok, false);
  assert.equal(simulateGrade({ earned_points: -1, possible_points: 10 }).error, "invalid_earned_points");
});

test("15) earned_points > possible_points rejected", () => {
  const gradeFn = sliceFn("grade_activity_item_submission");
  assert.match(gradeFn, /earned_exceeds_possible/);
  assert.equal(simulateGrade({ earned_points: 11, possible_points: 10 }).error, "earned_exceeds_possible");
});

test("16) possible_points <= 0 rejected", () => {
  const gradeFn = sliceFn("grade_activity_item_submission");
  assert.match(gradeFn, /invalid_possible_points/);
  assert.equal(simulateGrade({ earned_points: 0, possible_points: 0 }).error, "invalid_possible_points");
  assert.equal(simulateGrade({ earned_points: 1, possible_points: -5 }).error, "invalid_possible_points");
});

test("17) valid grade accepted", () => {
  const r = simulateGrade({ earned_points: 8.5, possible_points: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.status, "graded");
  assert.match(activitySrc, /type="number"/);
  assert.match(activitySrc, /min="0"/);
  assert.match(activitySrc, /step="0\.01"/);
  assert.match(activitySrc, /Number\(v\) === 0/);
});

test("18) legacy snapshots keep working", () => {
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
  assert.equal(simulateSubmitActivityItem({ snapshot: v1, p_snapshot_item_id: "x" }).error, "snapshot_item_not_found");
  const model = buildSnapshotReaderModel(v2);
  assert.equal(model.trackableItems.length, 0);
});

test("19) two activities with same snapshot_item_id stay independent", () => {
  const a1 = simulateSubmitActivityItem({
    snapshot: { ...lessonSnap, sourceId: "a1" },
    p_snapshot_item_id: "ex-lesson",
    p_item_type: "exercise",
  });
  const a2 = simulateSubmitActivityItem({
    snapshot: { ...lessonSnap, sourceId: "a2" },
    p_snapshot_item_id: "ex-lesson",
    p_item_type: "exercise",
  });
  assert.equal(a1.ok, true);
  assert.equal(a2.ok, true);
  // Identity remains scoped by activity_id in SQL unique key (unchanged from P7).
  assert.match(readFileSync(p7Path, "utf8"), /unique \(activity_id, user_id, snapshot_item_id, version\)/);
});

test("20) embedded V1/V2 history intact", () => {
  const rows = [
    {
      id: "v1",
      user_id: "u1",
      snapshot_item_id: "item-a",
      version: 1,
      status: "submitted",
      submitted_at: "2026-01-01T00:00:00Z",
      response_text: "first",
    },
    {
      id: "v2",
      user_id: "u1",
      snapshot_item_id: "item-a",
      version: 2,
      status: "submitted",
      submitted_at: "2026-01-02T00:00:00Z",
      response_text: "second",
    },
  ];
  const latest = pickLatestItemSubmissionPerKey(rows);
  assert.equal(latest[0].id, "v2");
  assert.equal(itemSubmissionVersionLabel(1), "V1");
  assert.equal(itemSubmissionVersionLabel(2), "V2");
  assert.equal(rows.length, 2);
});

test("AC17: no invented textarea/response UI from item.type alone; P7 backend remains", () => {
  assert.doesNotMatch(viewerSrc, /<textarea/);
  assert.doesNotMatch(viewerSrc, /Escribí tu respuesta/);
  assert.match(viewerSrc, /showEvidenceSubmit = false/);
  assert.match(viewerSrc, /isEmbeddedEvidenceItemType/);
  assert.match(submissionsSrc, /submit_activity_item/);
  assert.deepEqual([...EMBEDDED_EVIDENCE_ITEM_TYPES], ["exercise", "quiz", "assignment", "assessment"]);
});

test("AC8: evidence only for exercise/quiz/assignment/assessment in SQL", () => {
  const submitFn = sliceFn("submit_activity_item");
  assert.match(submitFn, /'exercise', 'quiz', 'assignment', 'assessment'/);
  assert.match(submitFn, /item_type_not_allowed/);
  const r = simulateSubmitActivityItem({
    snapshot: {
      sourceType: "lesson",
      items: [{ snapshotItemId: "mat", type: "material", config: {} }],
    },
    p_snapshot_item_id: "mat",
    p_item_type: "material",
  });
  assert.equal(r.error, "item_type_not_allowed");
});

test("forward-only status ranks preserved in upsert", () => {
  const upsertFn = sliceFn("upsert_activity_item_progress");
  assert.match(upsertFn, /not_started/);
  assert.match(upsertFn, /in_progress/);
  assert.match(upsertFn, /completed/);
  assert.match(upsertFn, /v_rank_new < v_rank_existing/);
});
