import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveSubmissionOverviewStatus,
  mapClassroomCourseWorkToActivity,
  submissionOverviewLabelEs,
} from "../src/platform/pybotClassApi.js";
import { canTeachCourse } from "../src/platform/courseRole.js";
import { fetchAllClassroomPages } from "../src/classroom/classroomApi.js";

const root = resolve(import.meta.dirname, "..");

// ── SEGURIDAD ────────────────────────────────────────────────────────────────

test("migración 031 elimina asub_update_own de activity_submissions", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000031_pybotclass_security_fix.sql"),
    "utf8",
  );
  assert.match(sql, /drop policy if exists asub_update_own/);
  assert.doesNotMatch(sql, /create policy asub_update_own/);
});

test("migración 031: submit_activity sigue existiendo en 027", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260830000027_activity_submissions.sql"),
    "utf8",
  );
  assert.match(sql, /create or replace function public\.submit_activity/);
  assert.match(sql, /security definer/);
});

test("migración 031: co-docente Classroom NO crea organization_members.teacher", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000031_pybotclass_security_fix.sql"),
    "utf8",
  );
  assert.match(sql, /NO crear organization_members\.teacher/);
  assert.match(sql, /'org_added', 0/);
  assert.doesNotMatch(sql, /values \(p_org_id, v_user_id, 'teacher'\)/);
});

test("migración 031: teacher Classroom removido si source=classroom", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000031_pybotclass_security_fix.sql"),
    "utf8",
  );
  assert.match(sql, /cm\.role = 'teacher'/);
  assert.match(sql, /cm\.source = 'classroom'/);
  assert.match(sql, /v_removed/);
});

test("course teacher puede enseñar curso A pero no implica org teacher", () => {
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "student" }), false);
});

// ── PYBOTCLASS LISTADOS ──────────────────────────────────────────────────────

test("migración 033 define list_pybotclass_my_courses", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000033_pybotclass_queries.sql"),
    "utf8",
  );
  assert.match(sql, /list_pybotclass_my_courses/);
  assert.match(sql, /organization_members om on om\.org_id = c\.org_id/);
  assert.match(sql, /course_members cm/);
});

// ── ENTREGAS ─────────────────────────────────────────────────────────────────

test("alumno sin submission → No entregó", () => {
  const status = deriveSubmissionOverviewStatus({ submission_id: null });
  assert.equal(status, "no_entrego");
  assert.equal(submissionOverviewLabelEs(status), "No entregó");
});

test("submitted → Por corregir", () => {
  const status = deriveSubmissionOverviewStatus({
    submission_id: "s1",
    submission_status: "submitted",
  });
  assert.equal(status, "por_corregir");
  assert.equal(submissionOverviewLabelEs(status), "Por corregir");
});

test("graded → Corregida", () => {
  const status = deriveSubmissionOverviewStatus({
    submission_id: "s1",
    submission_status: "graded",
  });
  assert.equal(status, "corregida");
});

test("overview RPC devuelve progress_updated_at", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000033_pybotclass_queries.sql"),
    "utf8",
  );
  assert.match(sql, /progress_updated_at/);
  assert.match(sql, /get_pybotclass_course_submission_overview/);
});

// ── NOTAS ────────────────────────────────────────────────────────────────────

test("gradebook RPC incluye students, activities y grades", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000033_pybotclass_queries.sql"),
    "utf8",
  );
  assert.match(sql, /get_pybotclass_gradebook/);
  assert.match(sql, /activity_submissions/);
  assert.match(sql, /s\.grade/);
});

// ── CLASSROOM ────────────────────────────────────────────────────────────────

test("classroomApi exporta listCourseWork con paginación", () => {
  const src = readFileSync(resolve(root, "src/classroom/classroomApi.js"), "utf8");
  assert.match(src, /export async function listCourseWork/);
  assert.match(src, /fetchAllClassroomPages/);
  assert.match(src, /nextPageToken/);
});

test("createCourseWork no hardcodea maxPoints = 100", () => {
  const src = readFileSync(resolve(root, "src/classroom/classroomApi.js"), "utf8");
  assert.doesNotMatch(src, /maxPoints:\s*maxPoints\s*\?\?\s*100/);
  assert.match(src, /if \(maxPoints != null/);
});

test("mapClassroomCourseWorkToActivity: origin=classroom y maxPoints", () => {
  const mapped = mapClassroomCourseWorkToActivity({
    id: "cw-1",
    title: "Sensor",
    description: "Desc",
    maxPoints: 10,
    dueDate: { year: 2026, month: 9, day: 10 },
    dueTime: { hours: 23, minutes: 59 },
    alternateLink: "https://classroom.google.com/c/1/a/1",
  });
  assert.equal(mapped.origin, "classroom");
  assert.equal(mapped.max_points, 10);
  assert.equal(mapped.classroom_coursework_id, "cw-1");
  assert.ok(mapped.due_at);
});

test("import no duplica: usa course_id + classroom_coursework_id", () => {
  const src = readFileSync(resolve(root, "src/platform/pybotClassApi.js"), "utf8");
  assert.match(src, /\.eq\("classroom_coursework_id"/);
  assert.match(src, /importClassroomActivities/);
});

test("publishActivityToClassroom usa max_points si existe", () => {
  const src = readFileSync(resolve(root, "src/platform/activityClassroom.js"), "utf8");
  assert.match(src, /activity\.max_points/);
  assert.match(src, /patchCourseWork/);
  assert.doesNotMatch(src, /alreadyPublished: true,\s*courseWorkId/);
});

test("grade_activity_submission rechaza nota > max_points", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000033_pybotclass_queries.sql"),
    "utf8",
  );
  assert.match(sql, /grade_exceeds_max_points/);
  assert.match(sql, /p_grade > v_max_points/);
});

test("sendGradeToClassroom exige max_points definido", () => {
  const src = readFileSync(resolve(root, "src/platform/activityClassroom.js"), "utf8");
  assert.match(src, /Definí el puntaje máximo/);
});

test("fetchAllClassroomPages pagina correctamente", async () => {
  let calls = 0;
  const items = await fetchAllClassroomPages(async (pageToken) => {
    calls += 1;
    if (!pageToken) {
      return { items: [{ id: 1 }], nextPageToken: "p2" };
    }
    return { items: [{ id: 2 }], nextPageToken: null };
  });
  assert.equal(calls, 2);
  assert.equal(items.length, 2);
});

// ── ROSTER ───────────────────────────────────────────────────────────────────

test("CourseRosterTab separa alumnos y docentes por role", () => {
  const src = readFileSync(resolve(root, "src/components/pybotclass/CourseRosterTab.jsx"), "utf8");
  assert.match(src, /role === "student"/);
  assert.match(src, /role === "teacher"/);
  assert.match(src, /pendingStudents/);
  assert.match(src, /pendingTeachers/);
});

test("migración 032: unique parcial classroom_coursework_id", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260831000032_pybotclass_activity_meta.sql"),
    "utf8",
  );
  assert.match(sql, /origin/);
  assert.match(sql, /due_at/);
  assert.match(sql, /max_points/);
  assert.match(sql, /activities_course_classroom_coursework_uidx/);
});
