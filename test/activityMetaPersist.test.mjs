import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  fetchCourseActivities,
  updatePybotclassActivity,
} from "../src/platform/pybotClassApi.js";
import { validateGradeForActivity } from "../src/platform/activityClassroom.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiSrc = readFileSync(resolve(root, "src/platform/pybotClassApi.js"), "utf8");
const activityPageSrc = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
const activitiesTabSrc = readFileSync(
  resolve(root, "src/components/pybotclass/CourseActivitiesTab.jsx"),
  "utf8",
);

function mockUpdateSupabase({ rpcError = null, updates = [] } = {}) {
  let updateIdx = 0;
  return {
    rpc: async () => ({ data: null, error: rpcError }),
    from(table) {
      assert.equal(table, "activities");
      return {
        update(payload) {
          const planned = updates[updateIdx++] ?? { error: null };
          updates._calls = updates._calls || [];
          updates._calls.push({ payload, error: planned.error });
          return {
            eq: async () => ({ data: null, error: planned.error }),
          };
        },
      };
    },
  };
}

function mockFetchSupabase(selectResults) {
  let i = 0;
  return {
    from(table) {
      assert.equal(table, "activities");
      return {
        select(cols) {
          const planned = selectResults[i++] ?? { data: [], error: null };
          selectResults._calls = selectResults._calls || [];
          selectResults._calls.push({ cols, ...planned });
          return {
            eq() {
              return {
                order: async () => ({
                  data: planned.data,
                  error: planned.error,
                }),
              };
            },
          };
        },
      };
    },
  };
}

test("A/B/C: updatePybotclassActivity envía due_at, submission_close_at y max_points", async () => {
  const updates = [{ error: null }];
  const sb = mockUpdateSupabase({ updates });
  const dueAt = "2026-09-17T23:00:00.000Z";
  const closeAt = "2026-09-18T02:59:00.000Z";
  const result = await updatePybotclassActivity(sb, "act-1", {
    title: "Actividad 1",
    description: "",
    pybotLessonId: "",
    starterCode: "",
    dueAt,
    submissionCloseAt: closeAt,
    maxPoints: "10",
  });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(updates._calls.length, 1);
  assert.equal(updates._calls[0].payload.due_at, dueAt);
  assert.equal(updates._calls[0].payload.submission_close_at, closeAt);
  assert.equal(updates._calls[0].payload.max_points, 10);
});

test("D: error de metadata genérico → ok=false con mensaje real", async () => {
  const updates = [{ error: { message: "new row violates row-level security policy" } }];
  const sb = mockUpdateSupabase({ updates });
  const result = await updatePybotclassActivity(sb, "act-1", {
    title: "Actividad 1",
    dueAt: "2026-09-17T23:00:00.000Z",
    maxPoints: 10,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /row-level security/i);
});

test("E: no existe false success por errores que mencionan due_at|max_points|submission_close_at", async () => {
  assert.doesNotMatch(
    apiSrc,
    /if \(error && !\/due_at\|max_points\|submission_close_at\/i\.test/,
  );
  assert.doesNotMatch(apiSrc, /if \(error && !\/due_at\|max_points\/i\.test/);

  const updates = [
    {
      error: {
        message: "Could not find the 'submission_close_at' column of 'activities' in the schema cache",
      },
    },
    { error: null },
  ];
  const sb = mockUpdateSupabase({ updates });
  const result = await updatePybotclassActivity(sb, "act-1", {
    title: "Actividad 1",
    dueAt: "2026-09-17T23:00:00.000Z",
    submissionCloseAt: "2026-09-18T02:59:00.000Z",
    maxPoints: 10,
  });
  // Usuario pidió cierre: no ok=true aunque due_at/max_points se hayan podido guardar.
  assert.equal(result.ok, false);
  assert.match(result.error, /migración 046|submission_close_at/i);
  assert.equal(result.partial?.due_at, true);
  assert.equal(result.partial?.max_points, true);
  assert.equal(result.partial?.submission_close_at, false);
});

test("compat: sin cierre y columna close ausente → guarda due_at+max_points con ok=true", async () => {
  const updates = [
    {
      error: {
        message: "Could not find the 'submission_close_at' column of 'activities' in the schema cache",
      },
    },
    { error: null },
  ];
  const sb = mockUpdateSupabase({ updates });
  const result = await updatePybotclassActivity(sb, "act-1", {
    title: "Actividad 1",
    dueAt: "2026-09-17T23:00:00.000Z",
    submissionCloseAt: null,
    maxPoints: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(updates._calls[1].payload.due_at, "2026-09-17T23:00:00.000Z");
  assert.equal(updates._calls[1].payload.max_points, 10);
  assert.equal(updates._calls[1].payload.submission_close_at, undefined);
});

test("F: fetchCourseActivities conserva due_at y max_points si falta submission_close_at", async () => {
  const rows = [
    {
      id: "a1",
      title: "Actividad 1",
      due_at: "2026-09-17T23:00:00.000Z",
      max_points: 10,
    },
  ];
  const selectResults = [
    {
      data: null,
      error: {
        message: "column activities.submission_close_at does not exist",
      },
    },
    { data: rows, error: null },
  ];
  const sb = mockFetchSupabase(selectResults);
  const { rows: out, error } = await fetchCourseActivities("course-1", sb);
  assert.equal(error, null);
  assert.equal(out.length, 1);
  assert.equal(out[0].due_at, "2026-09-17T23:00:00.000Z");
  assert.equal(out[0].max_points, 10);
  assert.match(selectResults._calls[1].cols, /due_at/);
  assert.match(selectResults._calls[1].cols, /max_points/);
  assert.doesNotMatch(selectResults._calls[1].cols, /submission_close_at/);
});

test("G: ActivityPage carga max_points (select completo y fallbacks)", () => {
  assert.match(activityPageSrc, /due_at, submission_close_at, max_points/);
  assert.match(activityPageSrc, /due_at, max_points, created_at/);
  assert.match(activityPageSrc, /content_lesson_id, due_at, max_points/);
});

test("H: CourseActivitiesTab solo cierra el form si result.ok", () => {
  assert.match(activitiesTabSrc, /if \(!result\.ok\)/);
  assert.match(activitiesTabSrc, /setLocalErr/);
  const closeIdx = activitiesTabSrc.indexOf("setEditing(null)");
  const guardIdx = activitiesTabSrc.indexOf("if (!result.ok)");
  assert.ok(guardIdx >= 0 && closeIdx > guardIdx);
});

test("I: updatePybotclassActivity no escribe version ni activity_submissions", () => {
  const fnStart = apiSrc.indexOf("export async function updatePybotclassActivity");
  const fnEnd = apiSrc.indexOf("\nexport ", fnStart + 10);
  const fnBody = apiSrc.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  assert.doesNotMatch(fnBody, /activity_submissions/);
  assert.doesNotMatch(fnBody, /\bversion\b/);
});

test("J: Classroom / validateGradeForActivity lee activity.max_points", () => {
  assert.equal(validateGradeForActivity({ max_points: 10 }, 4), null);
  assert.match(validateGradeForActivity({ max_points: 10 }, 11), /puntaje máximo \(10\)/);
  const classroomSrc = readFileSync(resolve(root, "src/platform/activityClassroom.js"), "utf8");
  assert.match(classroomSrc, /activity\?\.max_points == null/);
  assert.match(
    classroomSrc,
    /Definí el puntaje máximo de la actividad antes de enviar notas a Classroom/,
  );
});
