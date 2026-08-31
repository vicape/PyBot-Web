import { test } from "node:test";
import assert from "node:assert/strict";
import { canTeachCourse, isCourseStudent } from "../src/platform/courseRole.js";
import { mapEnrolledCourseRows } from "../src/platform/studentCoursesApi.js";
import { submissionStatusLabelEs } from "../src/platform/activitySubmissions.js";
import { summarizeClassroomSyncResults } from "../src/classroom/classroomRosterSync.js";
import { matchClassroomSubmission } from "../src/platform/activityClassroom.js";

test("roles: teacher org enseña; course teacher enseña; student no", () => {
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "student" }), false);
});

test("Mis cursos: solo role student (co-docente no aparece)", () => {
  // mapEnrolledCourseRows no filtra role; el filtro está en el query .eq("role","student")
  // Verificamos que isCourseStudent discrimina correctamente
  assert.equal(isCourseStudent({ courseRole: "student" }), true);
  assert.equal(isCourseStudent({ courseRole: "teacher" }), false);
  const rows = [
    {
      course_id: "c1",
      courses: {
        id: "c1",
        title: "A",
        created_at: "2026-01-01",
        org_id: "o1",
        organizations: { name: "X" },
      },
    },
  ];
  assert.equal(mapEnrolledCourseRows(rows).length, 1);
});

test("entregas: statuses etiquetados", () => {
  assert.equal(submissionStatusLabelEs("submitted"), "Entregada");
  assert.equal(submissionStatusLabelEs("graded"), "Corregida");
  assert.notEqual(submissionStatusLabelEs("submitted"), submissionStatusLabelEs("draft"));
});

test("classroom sync summary cuenta estados", () => {
  const s = summarizeClassroomSyncResults([
    { status: "importado" },
    { status: "no_registrado" },
    { status: "actualizado" },
  ]);
  assert.equal(s.imported, 1);
  assert.equal(s.noRegistrado, 1);
  assert.equal(s.updated, 1);
});

test("match Classroom submission por google user id", () => {
  const map = new Map([["u1", "g-123"]]);
  assert.equal(
    matchClassroomSubmission({ userId: "g-123" }, { user_id: "u1" }, null, map),
    true,
  );
  assert.equal(
    matchClassroomSubmission({ userId: "other" }, { user_id: "u1" }, null, map),
    false,
  );
});
