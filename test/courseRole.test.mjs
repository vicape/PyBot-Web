import { test } from "node:test";
import assert from "node:assert/strict";
import { canTeachCourse, isCourseStudent } from "../src/platform/courseRole.js";

test("org owner/teacher puede enseñar cualquier curso de la org", () => {
  assert.equal(canTeachCourse({ orgRole: "owner", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "student" }), true);
});

test("course_members.teacher puede enseñar su curso", () => {
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "teacher" }), true);
});

test("alumno no puede enseñar", () => {
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "student" }), false);
  assert.equal(canTeachCourse({}), false);
});

test("isCourseStudent solo con role student", () => {
  assert.equal(isCourseStudent({ courseRole: "student" }), true);
  assert.equal(isCourseStudent({ courseRole: "teacher" }), false);
  assert.equal(isCourseStudent({}), false);
});
