import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("migración 026 define is_course_teacher", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260830000026_course_teacher_permissions.sql"),
    "utf8",
  );
  assert.match(sql, /is_course_teacher/);
  assert.match(sql, /course_members\.role = 'teacher'/);
  assert.match(sql, /sync_classroom_course_teachers/);
});

test("migración 027 define activity_submissions y RPCs", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260830000027_activity_submissions.sql"),
    "utf8",
  );
  assert.match(sql, /create table if not exists public\.activity_submissions/);
  assert.match(sql, /submit_activity/);
  assert.match(sql, /grade_activity_submission/);
  assert.match(sql, /activity_progress/);
});

test("migración 030 solo borra telemetría via is_super_admin", () => {
  const sql = readFileSync(
    resolve(root, "supabase/migrations/20260830000030_admin_delete_telemetry.sql"),
    "utf8",
  );
  assert.match(sql, /admin_delete_usage_session/);
  assert.match(sql, /admin_delete_user_telemetry/);
  assert.match(sql, /is_super_admin/);
  assert.doesNotMatch(sql, /alter table public\.usage_sessions/);
  assert.doesNotMatch(sql, /\bip_hash\b/);
});

test("classroomApi exporta courseWork y teachers", () => {
  const src = readFileSync(resolve(root, "src/classroom/classroomApi.js"), "utf8");
  assert.match(src, /export async function listCourseTeachers/);
  assert.match(src, /export async function createCourseWork/);
  assert.match(src, /export async function listStudentSubmissions/);
  assert.match(src, /export async function patchStudentSubmissionGrade/);
  assert.match(src, /export async function returnStudentSubmission/);
});

test("studentCoursesApi filtra role=student", () => {
  const src = readFileSync(resolve(root, "src/platform/studentCoursesApi.js"), "utf8");
  assert.match(src, /\.eq\("role", "student"\)/);
});

test("CourseActivitiesPage permite roster vacío", () => {
  const src = readFileSync(resolve(root, "src/pages/CourseActivitiesPage.jsx"), "utf8");
  assert.doesNotMatch(
    src,
    /No se encontraron alumnos en este curso de Classroom/,
  );
  assert.match(src, /Classroom actualmente devuelve 0 alumnos/);
});
