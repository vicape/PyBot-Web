import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourseRole } from "../src/platform/courseRole.js";
import {
  computeAccountRoleBadges,
  computeQuickSummary,
} from "../src/platform/accountRoles.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("P19 normalizeCourseRole: owner/teacher/student/unknown", () => {
  assert.equal(normalizeCourseRole("owner"), "teacher");
  assert.equal(normalizeCourseRole("teacher"), "teacher");
  assert.equal(normalizeCourseRole("student"), "student");
  assert.equal(normalizeCourseRole(null), null);
  assert.equal(normalizeCourseRole(undefined), null);
  assert.equal(normalizeCourseRole(""), null);
  assert.equal(normalizeCourseRole("admin"), null);
  assert.equal(normalizeCourseRole("otro"), null);
});

test("P19 owner nunca cae en student", () => {
  assert.notEqual(normalizeCourseRole("owner"), "student");
  assert.equal(normalizeCourseRole("owner"), "teacher");
});

test("P19 filtro Docente incluye owner; Alumno no", () => {
  const courses = [
    { course_id: "a", my_course_role: "owner" },
    { course_id: "b", my_course_role: "teacher" },
    { course_id: "c", my_course_role: "student" },
    { course_id: "d", my_course_role: null },
  ];
  const teachers = courses.filter((c) => normalizeCourseRole(c.my_course_role) === "teacher");
  const students = courses.filter((c) => normalizeCourseRole(c.my_course_role) === "student");
  assert.deepEqual(
    teachers.map((c) => c.course_id),
    ["a", "b"],
  );
  assert.deepEqual(
    students.map((c) => c.course_id),
    ["c"],
  );
});

test("P19 computeQuickSummary cuenta owner como docente", () => {
  const items = computeQuickSummary({
    courses: [
      { my_course_role: "owner", student_count: 2, activity_count: 1, pending_grade_count: 0 },
      { my_course_role: "teacher", student_count: 1, activity_count: 1, pending_grade_count: 0 },
      { my_course_role: "student", student_count: 0, activity_count: 0, pending_grade_count: 0 },
    ],
  });
  assert.equal(items.find((i) => i.id === "teacher")?.value, "2");
  assert.equal(items.find((i) => i.id === "student")?.value, "1");
});

test("P19 computeAccountRoleBadges: owner org no agrega Alumno solo por owner curso", () => {
  const badges = computeAccountRoleBadges({
    orgs: [{ role: "owner" }],
    courses: [{ my_course_role: "owner" }],
  });
  const ids = badges.map((b) => b.id);
  assert.ok(ids.includes("gestion"));
  assert.ok(ids.includes("docente"));
  assert.ok(!ids.includes("alumno"));
});

test("P19 multirol: Gestión + Docente + Alumno cuando hay student explícito", () => {
  const badges = computeAccountRoleBadges({
    orgs: [{ role: "owner" }],
    courses: [{ my_course_role: "owner" }, { my_course_role: "student" }],
  });
  const ids = badges.map((b) => b.id);
  assert.ok(ids.includes("gestion"));
  assert.ok(ids.includes("docente"));
  assert.ok(ids.includes("alumno"));
});

test("P19 unknown no cuenta como docente ni alumno", () => {
  const items = computeQuickSummary({
    courses: [{ my_course_role: null }, { my_course_role: "admin" }],
  });
  assert.equal(items.find((i) => i.id === "teacher"), undefined);
  assert.equal(items.find((i) => i.id === "student"), undefined);
});

test("P19 sin fallback ROLE_BADGE.student para roles desconocidos", () => {
  const home = readSrc("src/components/pybotclass/layout/PyBotClassHome.jsx");
  assert.doesNotMatch(home, /ROLE_BADGE\[.*\]\s*\|\|\s*ROLE_BADGE\.student/);
  assert.match(home, /normalizeCourseRole/);
  const api = readSrc("src/platform/pybotClassApi.js");
  assert.match(api, /withNormalizedCourseRole/);
  assert.match(api, /normalizeCourseRole/);
});
