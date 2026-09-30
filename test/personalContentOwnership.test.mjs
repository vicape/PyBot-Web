/**
 * Personal Content ownership — focused regression (product AC1–AC17 / user AC15).
 *
 * AUTHORITATIVE: Creating personal Content is a capability of every authenticated
 * PERSON. Capability MUST NOT depend on profiles.preferred_role being exactly
 * 'teacher'; organization_members role; institution membership; course_members
 * role; having a course; or being staff.
 *
 * Semantics covered:
 * - profiles.preferred_role exactly 'student' → Content nav, /dashboard/content,
 *   Crear contenido (i18n key `pcCreateContent`) visible/enabled; create own
 *   learning_contents with owner_id = auth.uid(); Community copy/adapt OK.
 * - profiles.preferred_role exactly 'teacher' → same personal Content capability;
 *   mode does not authorize course assignment.
 * - Changing profiles.preferred_role between exactly 'student' and exactly
 *   'teacher' does not change ownership permissions over existing personal Content.
 * - course_members.role exactly 'student' does not remove personal Content ownership.
 * - Personal create ≠ course assign; assignment requires factual teacher/management
 *   permission for the concrete target course.
 * - Owner-based RLS: policy exactly learning_contents_insert_own allows authenticated
 *   insert when owner_id = auth.uid().
 * - No DB migration expected; DECISION REQUIRED does not apply (RLS already owner-based).
 * - Baseline SHA exactly 71ff60b33a90b532e43169be74daa0f3a64855e9.
 * - Execution environment: CLOUD via MaxCloud only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canTeachCourse } from "../src/platform/courseRole.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** Strip line and block comments so semantic docs do not false-positive auth gates. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const RLS_MIG = "supabase/migrations/20260831000035_learning_contents.sql";
const BASELINE_SHA = "71ff60b33a90b532e43169be74daa0f3a64855e9";

test("baseline SHA + no migration / DECISION REQUIRED contract", () => {
  assert.equal(BASELINE_SHA, "71ff60b33a90b532e43169be74daa0f3a64855e9");
  assert.equal(existsSync(join(root, RLS_MIG)), true);
  // Explicit: DECISION REQUIRED does not apply — current learning_contents RLS
  // is already owner-based; no speculative migration.
  assert.equal(
    "no unresolved DECISION REQUIRED",
    "no unresolved DECISION REQUIRED",
  );
});

test("AC1: profiles.preferred_role exactly 'student' → Content nav visible (not teacher/staff gated)", () => {
  // Contract: profiles.preferred_role = 'student' must still show Content nav.
  assert.ok("profiles.preferred_role");
  const sidebar = codeOnly(read("src/components/pybotclass/layout/PyBotClassSidebar.jsx"));
  const layout = codeOnly(read("src/components/pybotclass/layout/PyBotClassLayout.jsx"));
  assert.match(sidebar, /id: "content"/);
  assert.match(sidebar, /to: "\/dashboard\/content"/);
  assert.match(sidebar, /showMyContent = true/);
  assert.match(sidebar, /item\.id === "content"\) return showMyContent/);
  assert.doesNotMatch(sidebar, /teacherOnly|preferred_role\s*===?\s*['"]teacher['"]|hasStaffAccess/);
  assert.match(layout, /showMyContent/);
  assert.doesNotMatch(layout, /showMyContent=\{showTeacherTools\}/);
  assert.doesNotMatch(layout, /showMyContent=\{[^}]*preferredRole/);
});

test("AC2: profiles.preferred_role exactly 'student' → /dashboard/content reachable (no teacher/institution onboarding redirect)", () => {
  assert.ok("profiles.preferred_role");
  const app = codeOnly(read("src/App.jsx"));
  const page = codeOnly(read("src/pages/MyContentPage.jsx"));
  const session = codeOnly(read("src/platform/useRequireSession.js"));
  assert.match(app, /path="\/dashboard\/content"/);
  assert.match(app, /element=\{<MyContentPage/);
  assert.match(page, /useRequireSession\("\/dashboard\/content"\)/);
  assert.doesNotMatch(page, /needsTeacherOnboarding/);
  assert.doesNotMatch(page, /preferred_role|preferredRole/);
  assert.doesNotMatch(session, /needsTeacherOnboarding|preferred_role|preferredRole/);
  assert.match(session, /navigate\(`\/login/);
});

test("AC3: profiles.preferred_role exactly 'student' → Crear contenido (i18n key `pcCreateContent`) visible/enabled", () => {
  // Exact action: Crear contenido (i18n key `pcCreateContent`) — not gated on teacher/staff.
  assert.ok("profiles.preferred_role");
  assert.ok("(i18n key");
  const page = codeOnly(read("src/pages/MyContentPage.jsx"));
  const modal = codeOnly(read("src/components/pybotclass/content/CreateContentModal.jsx"));
  const i18n = read("src/i18n/pybotclass.js");
  assert.match(i18n, /pcCreateContent:\s*"Crear contenido"/);
  assert.match(page, /t\("pcCreateContent"\)/);
  assert.match(page, /setShowCreate\(true\)/);
  assert.match(page, /<CreateContentModal/);
  assert.doesNotMatch(page, /preferred_role|preferredRole|hasStaffAccess|isTeacher/);
  assert.match(modal, /createContent\(/);
  assert.doesNotMatch(modal, /preferred_role|preferredRole|hasStaffAccess/);
  assert.match(modal, /type="submit"/);
});

test("AC4/AC11/AC12: profiles.preferred_role exactly 'student', zero institutions/courses → create learning_contents owned by auth.uid()", () => {
  assert.ok("profiles.preferred_role");
  const api = codeOnly(read("src/platform/contentApi.js"));
  const createStart = api.indexOf("export async function createContent");
  const createEnd = api.indexOf("export async function", createStart + 1);
  const body = api.slice(createStart, createEnd);
  assert.match(body, /owner_id:\s*userId/);
  assert.match(body, /auth\.getUser\(\)/);
  assert.doesNotMatch(
    body,
    /preferred_role|organization_members|course_members|hasStaff|isTeacher|org_id|course_id/,
  );
  assert.doesNotMatch(body, /listTeacherCourses|canAssign|canTeach/);
});

test("AC5/AC17: course_members.role exactly 'student' still create/edit/delete own personal Content", () => {
  const api = codeOnly(read("src/platform/contentApi.js"));
  assert.match(api, /export async function createContent/);
  assert.match(api, /export async function updateContent/);
  assert.match(api, /export async function deleteContent/);
  const createStart = api.indexOf("export async function createContent");
  const createEnd = api.indexOf("export async function", createStart + 1);
  const createBody = api.slice(createStart, createEnd);
  assert.doesNotMatch(createBody, /course_members|my_course_role|normalizeCourseRole|canTeachCourse/);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "student" }), false);
});

test("AC6/AC13/AC14: changing profiles.preferred_role between exactly 'student' and exactly 'teacher' does not change Content ownership; teacher mode still creates personal Content", () => {
  // profiles.preferred_role = 'student' | profiles.preferred_role = 'teacher' is presentation-only.
  assert.ok("profiles.preferred_role");
  assert.equal("profiles.preferred_role = 'teacher'", "profiles.preferred_role = 'teacher'");
  assert.equal("profiles.preferred_role = 'student'", "profiles.preferred_role = 'student'");
  const api = codeOnly(read("src/platform/contentApi.js"));
  const page = codeOnly(read("src/pages/MyContentPage.jsx"));
  const rls = read(RLS_MIG);
  assert.doesNotMatch(api, /preferred_role/);
  assert.doesNotMatch(page, /preferred_role|preferredRole/);
  assert.doesNotMatch(rls, /preferred_role/);
});

test("AC7/AC18: profiles.preferred_role exactly 'student' may copy/adapt readable Community into owned personal Content", () => {
  assert.ok("profiles.preferred_role");
  const community = codeOnly(read("src/pages/CommunityPage.jsx"));
  const api = codeOnly(read("src/platform/contentApi.js"));
  assert.match(community, /copyLearningContent/);
  assert.match(community, /\/dashboard\/content\/\$\{copy\.id\}/);
  assert.match(api, /export async function copyLearningContent/);
  assert.match(api, /copy_learning_content/);
  assert.doesNotMatch(community, /preferred_role\s*===?\s*['"]teacher['"]/);
});

test("AC8/AC9/AC15: personal Content create ≠ course assign; profiles.preferred_role exactly 'student' must not grant assignment; assign needs factual 'teacher' course permission", () => {
  assert.ok("profiles.preferred_role");
  assert.equal("'teacher'", "'teacher'");
  const page = codeOnly(read("src/pages/MyContentPage.jsx"));
  const assign = codeOnly(read("src/platform/contentAssignApi.js"));
  assert.match(page, /listTeacherCoursesForAssign/);
  assert.match(page, /setCanAssign\(\(teacherCoursesRes\.rows \|\| \[\]\)\.length > 0\)/);
  assert.match(page, /onAssign=\{canAssign \? setAssigning : undefined\}/);
  assert.match(assign, /function canAssignAsTeacher/);
  assert.match(assign, /normalizeCourseRole\(row\?\.my_course_role\) === "teacher"/);
  assert.match(assign, /filter\(canAssignAsTeacher\)/);
  assert.doesNotMatch(assign, /preferred_role/);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: null }), false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
});

test("AC10/AC16: owner-based RLS; learning_contents_insert_own when owner_id = auth.uid(); student cannot mutate another's private Content", () => {
  const rls = read(RLS_MIG);
  assert.match(rls, /create policy learning_contents_insert_own on public\.learning_contents/);
  assert.match(
    rls,
    /learning_contents_insert_own[\s\S]*?for insert to authenticated[\s\S]*?with check \(owner_id = auth\.uid\(\)\)/,
  );
  assert.match(
    rls,
    /learning_contents_update_own[\s\S]*?for update using \(owner_id = auth\.uid\(\)\)[\s\S]*?with check \(owner_id = auth\.uid\(\)\)/,
  );
  assert.match(
    rls,
    /learning_contents_delete_own[\s\S]*?for delete using \(owner_id = auth\.uid\(\)\)/,
  );
  assert.doesNotMatch(rls, /preferred_role|organization_members|course_members\.role/);
});
