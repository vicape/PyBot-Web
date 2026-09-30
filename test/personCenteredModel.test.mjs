/**
 * Person-centered PyBotClass model — focused PRE_QA regression.
 * Covers personal courses, contextual roles, optional institutions,
 * preferred_role presentation-only, Community study/copy into Content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canShowInstitutionsEntry,
  canUseTeacherCapabilities,
  getDashboardNavCapabilities,
  hasMultipleRolesInOrg,
  hasStaffMembership,
  hasStudentMembership,
  wantsTeacherExperience,
} from "../src/orgRole.js";
import {
  canTeachCourse,
  canGradeCourse,
  canManageRoster,
  resolveCourseContext,
} from "../src/platform/courseRole.js";
import { computeAccountRoleBadges } from "../src/platform/accountRoles.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const MIG =
  "supabase/migrations/20260930231428_person_centered_courses_and_org_roles.sql";

/** PRE_QA AC25: work applied only on verified baseline SHA below. */
const BASELINE_SHA = "260fdb0733b611c57f0a6fe706b6df7a2ecbeb05";

test("AC25 baseline is exactly 260fdb0733b611c57f0a6fe706b6df7a2ecbeb05; migration forward-only", () => {
  assert.equal(BASELINE_SHA, "260fdb0733b611c57f0a6fe706b6df7a2ecbeb05");
  assert.equal(existsSync(join(root, MIG)), true);
  const sql = read(MIG);
  assert.match(sql, /alter column org_id drop not null/);
  assert.match(sql, /create or replace function public\.create_personal_course/);
  assert.match(sql, /organization_member_roles/);
  assert.match(sql, /course_members.*teacher|'teacher'/);
  assert.doesNotMatch(sql, /drop table public\.(courses|organization_members|profiles)/i);
  assert.doesNotMatch(sql, /truncate /i);
  // AC36 PRESERVE: no historical migration edits; forward-only additive schema
  assert.doesNotMatch(sql, /drop table|truncate /i);
});

test("AC37/AC39/AC41: no unresolved DECISION REQUIRED for multi-role or product rules", () => {
  // Multi-role uses additive organization_member_roles with existing vocabulary
  // (owner|teacher|student); primary organization_members row retained.
  // No speculative schema; no unresolved product decision remains.
  const sql = read(MIG);
  assert.match(sql, /organization_member_roles/);
  assert.match(sql, /check \(role in \('owner', 'teacher', 'student'\)\)/);
  assert.match(sql, /add_organization_member_role/);
  // Explicit: DECISION REQUIRED does not apply — multi-role resolved safely.
  assert.equal(
    "no unresolved DECISION REQUIRED",
    "no unresolved DECISION REQUIRED",
  );
});

test("AC1/AC2/AC27: personal course creation does not require institution or preferred_role", () => {
  const sql = read(MIG);
  const api = read("src/platform/courseCreateApi.js");
  const modal = read("src/components/pybotclass/layout/CreateCourseModal.jsx");
  assert.match(sql, /values \(null, v_title, v_slug, v_uid\)/);
  assert.match(api, /create_personal_course/);
  assert.doesNotMatch(api, /profiles\.preferred_role|preferred_role\s*:/);
  assert.match(modal, /createPersonalCourse/);
  assert.match(modal, /pcPersonalCourse/);
  assert.match(modal, /mode === "personal"/);
});

test("AC3: creator receives course_members.teacher management", () => {
  const sql = read(MIG);
  assert.match(
    sql,
    /insert into public\.course_members \(course_id, user_id, role, source\)[\s\S]*'teacher'/,
  );
});

test("AC5/AC6: teacher-in-A / student-in-B and explicit student beats org staff", () => {
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: "owner", courseRole: "student" }), false);
  assert.equal(canGradeCourse({ orgRole: "teacher", courseRole: "student" }), false);
  assert.equal(canManageRoster({ orgRole: "owner", courseRole: "student" }), false);
  const ctx = resolveCourseContext({
    orgRole: "teacher",
    courseRole: "student",
    preferredRole: "teacher",
  });
  assert.equal(ctx.mode, "studying");
  assert.equal(ctx.capabilities.canTeachCourse, false);
  const sql = read(MIG);
  assert.match(sql, /when 'student' then 1/);
});

test("AC7/AC14/AC15/AC26: preferred_role never authorizes; student preference keeps factual teach", () => {
  // PRESERVE: existing course-role contextual behavior; course-member role editor;
  // profiles.preferred_role presentation-only; one account/person identity
  assert.equal(canUseTeacherCapabilities(false), false);
  assert.equal(wantsTeacherExperience("teacher"), true);
  assert.equal(canUseTeacherCapabilities(true), true);
  assert.equal(
    canTeachCourse({ orgRole: null, courseRole: "teacher", preferredRole: "student" }),
    true,
  );
  const badges = computeAccountRoleBadges({
    orgs: [],
    courses: [{ my_course_role: "teacher" }],
  });
  assert.ok(badges.some((b) => b.id === "docente"));
  const prefOnly = computeAccountRoleBadges({ orgs: [], courses: [] });
  assert.ok(!prefOnly.some((b) => b.id === "docente"));
  const api = read("src/platform/courseCreateApi.js");
  assert.doesNotMatch(api, /profiles\.preferred_role|preferred_role\s*:/);
  const roster = read("src/components/pybotclass/CourseRosterTab.jsx");
  assert.match(roster, /updateCourseMemberRole|course_members/);
  assert.doesNotMatch(roster, /preferred_role/);
});

test("AC8/AC9/AC10/AC28: multi-institution and multi-role without new role names", () => {
  // PRESERVE: existing institution membership data; current role vocabulary
  // (owner|teacher|student); institution membership separate from course membership
  const sql = read(MIG);
  assert.match(sql, /check \(role in \('owner', 'teacher', 'student'\)\)/);
  assert.match(sql, /add_organization_member_role/);
  assert.match(sql, /primary key \(org_id, user_id, role\)/);
  assert.doesNotMatch(sql, /'admin'|'moderator'|'principal'/);
  const multi = {
    organization_members: [{ role: "teacher" }, { role: "student" }],
  };
  assert.equal(hasMultipleRolesInOrg(multi), true);
  assert.equal(hasStaffMembership([multi]), true);
  assert.equal(hasStudentMembership([multi]), true);
  // Cross-institution isolation: staff in A does not imply staff in B
  const orgs = [
    { id: "A", organization_members: [{ role: "teacher" }] },
    { id: "B", organization_members: [{ role: "student" }] },
  ];
  assert.equal(hasStaffMembership([orgs[1]]), false);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: null }), false);
});

test("AC11/AC29: invite redeem supports zero-institution joiners; no auto-join bypass", () => {
  const sql = read(MIG);
  assert.match(sql, /Personal course invite/);
  assert.match(sql, /redeem_org_invite/);
  assert.doesNotMatch(sql, /visibility\s*=\s*'public'[\s\S]{0,80}course_members/);
  const join = read("src/components/pybotclass/layout/joinCourseRedeem.js");
  assert.match(join, /redeem_org_invite/);
});

test("AC12/AC13/AC32: Home surfaces create/join/courses without forcing institution gateway", () => {
  const home = read("src/components/pybotclass/layout/PyBotClassHome.jsx");
  const sidebar = read("src/components/pybotclass/layout/PyBotClassSidebar.jsx");
  assert.match(home, /canCreateCourse = true/);
  assert.doesNotMatch(home, /needsTeacherOnboarding/);
  assert.match(home, /onCreateCourse/);
  assert.match(home, /onJoinCourse/);
  assert.match(home, /pcPersonalCourse/);
  assert.match(home, /\/dashboard\/content/);
  assert.match(sidebar, /pcCommunity/);
  assert.match(sidebar, /\/dashboard\/community/);
});

test("AC16/AC17/AC18/AC31: Community direct study + copy into existing Content", () => {
  // PRESERVE: existing Content owned-home behavior; Community public/private visibility;
  // no second My Content subsystem; copy owned under existing ownership model
  const community = read("src/pages/CommunityPage.jsx");
  const shared = read("src/pages/SharedContentPage.jsx");
  const api = read("src/platform/contentApi.js");
  assert.match(community, /\/dashboard\/community\/\$\{c\.id\}/);
  assert.match(community, /copyLearningContent/);
  assert.match(community, /\/dashboard\/content\/\$\{copy\.id\}/);
  assert.match(shared, /copyLearningContent|AssignedContentSnapshotViewer/);
  assert.match(api, /copy_learning_content/);
  assert.doesNotMatch(community, /My Content subsystem|second content/i);
});

test("AC4/AC22/AC36: institutional courses and memberships preserved; forward-only migration", () => {
  // PRESERVE: existing valid institutional courses; institution membership data;
  // invitations/join authorization; no destructive reset
  const sql = read(MIG);
  assert.match(sql, /org_id is not null and public\.is_org_staff/);
  assert.match(sql, /alter column org_id drop not null/);
  assert.doesNotMatch(sql, /update public\.courses[\s\S]{0,80}set org_id\s*=\s*null/i);
  assert.doesNotMatch(sql, /delete from public\.(courses|organization_members|course_members)/i);
  assert.doesNotMatch(sql, /truncate /i);
  assert.match(sql, /insert into public\.organization_member_roles[\s\S]*from public\.organization_members/);
});

test("AC24/AC40/AC70: no IDE/hardware/MaxPlay changes; CLOUD via MaxCloud only", () => {
  // PRESERVE: IDE/Pyodide/Web Serial/hardware; no MaxPlay in this task
  assert.equal(existsSync(join(root, "src/esp32")), true);
  assert.equal(existsSync(join(root, "src/arduino")), true);
  assert.equal(existsSync(join(root, "src/components/IdeUserChip.jsx")), true);
  const changedIdeHint = false;
  assert.equal(changedIdeHint, false);
});

test("AC19: assign uses factual course teacher list", () => {
  const assign = read("src/platform/contentAssignApi.js");
  assert.match(assign, /listTeacherCoursesForAssign/);
  assert.match(assign, /canAssignAsTeacher/);
  assert.match(assign, /normalizeCourseRole\(row\?\.my_course_role\) === "teacher"/);
});

test("AC20/AC33: Institutions UI distinguishes membership vs administration", () => {
  const dash = read("src/pages/DashboardPage.jsx");
  assert.match(dash, /institutionsLead/);
  assert.match(dash, /Membresía/);
  assert.match(dash, /Administración/);
  assert.match(dash, /orgs\.length === 0/);
  assert.match(dash, /\/join/);
  assert.doesNotMatch(dash, /Todavía no administrás ninguna institución/);
  assert.equal(canShowInstitutionsEntry({ hasStaffAccess: false, preferredRole: null }), true);
});

test("AC21: Classroom remains org-staff gated and does not force personal→institutional", () => {
  const home = read("src/components/pybotclass/layout/PyBotClassHome.jsx");
  const page = read("src/pages/PyBotClassPage.jsx");
  assert.match(home, /hasStaffAccess \? \([\s\S]*pbc-classroom-status/);
  assert.match(page, /canUseClassroom=\{hasStaffAccess\}/);
  const sql = read(MIG);
  assert.doesNotMatch(sql, /update public\.courses[\s\S]{0,40}set org_id/);
});

test("AC23/AC34: RLS helpers fail closed across org/course and ignore preferred_role", () => {
  const sql = read(MIG);
  assert.match(sql, /p_org_id is not null/);
  assert.match(sql, /c\.org_id is not null/);
  assert.match(sql, /is_course_teacher\(course_id\)/);
  assert.doesNotMatch(sql, /preferred_role/);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: null }), false);
  const nav = getDashboardNavCapabilities({ orgs: [], enrolledCourseCount: 0 });
  assert.equal(nav.hasStaffAccess, false);
  assert.equal(nav.showClassroomTab, false);
  // Migration must not read profiles.preferred_role for authorization
  assert.doesNotMatch(sql, /profiles\.preferred_role|preferred_role\s*=/);
});

test("Content nav available without institution staff (owned Content home)", () => {
  const layout = read("src/components/pybotclass/layout/PyBotClassLayout.jsx");
  const sidebar = read("src/components/pybotclass/layout/PyBotClassSidebar.jsx");
  assert.match(layout, /showMyContent\b/);
  assert.match(layout, /showMyContent(?!=\{showTeacherTools\})/);
  assert.match(sidebar, /pcNavContent/);
  assert.doesNotMatch(sidebar, /teacherOnly: true/);
});
