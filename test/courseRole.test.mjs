import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COURSE_ACCESS_MODES,
  canGradeCourse,
  canManageOrganization,
  canManagePlatform,
  canManageRoster,
  canStudyCourse,
  canTeachCourse,
  courseDisplayRoleI18nKey,
  courseTabIdsForMode,
  formatCurrentRoleCompact,
  formatCurrentRoleLabel,
  isCourseStudent,
  normalizeCourseRole,
  resolveCourseContext,
} from "../src/platform/courseRole.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const tEs = (key) =>
  ({
    pcCurrentRole: "Rol actual:",
    pcTeacher: "Docente",
    pcCoTeacher: "Co-docente",
    pcStudent: "Alumno",
    pcSuperadmin: "Superadmin",
    pcManagement: "Gestión",
  })[key] || key;

test("normalizeCourseRole mapea owner a teacher", () => {
  assert.equal(normalizeCourseRole("owner"), "teacher");
});

test("org owner/teacher puede enseñar cualquier curso de la org", () => {
  assert.equal(canTeachCourse({ orgRole: "owner", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "student" }), true);
});

test("course_members.teacher u owner puede enseñar su curso", () => {
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "owner" }), true);
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
  assert.equal(isCourseStudent({ courseRole: "owner" }), false);
  assert.equal(isCourseStudent({}), false);
});

// ── ROLE-01 … ROLE-11 ────────────────────────────────────────────────────────

test("ROLE-01 owner in own course -> Docente, teaching", () => {
  const ctx = resolveCourseContext({ orgRole: "owner", courseRole: null });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "teacher");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Docente");
  assert.equal(formatCurrentRoleCompact(ctx.displayRole, tEs), "Docente");
  assert.equal(ctx.capabilities.canTeachCourse, true);
  assert.equal(ctx.capabilities.canManageOrganization, true);
});

test("ROLE-02 org teacher -> Docente, teaching", () => {
  const ctx = resolveCourseContext({ orgRole: "teacher", courseRole: null });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "teacher");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Docente");
});

test("ROLE-03 course-specific teacher -> Co-docente, teaching", () => {
  const ctx = resolveCourseContext({ orgRole: null, courseRole: "teacher" });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "co_teacher");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Co-docente");
  assert.equal(formatCurrentRoleCompact(ctx.displayRole, tEs), "Co-docente");
  assert.equal(ctx.capabilities.canTeachCourse, true);
});

test("ROLE-04 student -> Alumno, studying", () => {
  const ctx = resolveCourseContext({ orgRole: "student", courseRole: "student" });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(ctx.displayRole, "student");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Alumno");
  assert.equal(formatCurrentRoleCompact(ctx.displayRole, tEs), "Alumno");
  assert.equal(ctx.capabilities.canStudyCourse, true);
  assert.equal(ctx.capabilities.canTeachCourse, false);
});

test("ROLE-05 superadmin no pedagogical membership -> Superadmin, admin, no teacher controls", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: null,
    isSuperAdmin: true,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.ADMIN);
  assert.equal(ctx.displayRole, "superadmin");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Superadmin");
  assert.equal(formatCurrentRoleCompact(ctx.displayRole, tEs), "Superadmin");
  assert.equal(ctx.capabilities.canManagePlatform, true);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(ctx.capabilities.canStudyCourse, false);
  assert.deepEqual([...courseTabIdsForMode(ctx.mode)], ["resumen", "actividades"]);
  assert.ok(!courseTabIdsForMode(ctx.mode).includes("alumnos"));
  assert.ok(!courseTabIdsForMode(ctx.mode).includes("entregas"));
});

test("ROLE-06 superadmin + student -> Alumno, studying", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: "student",
    isSuperAdmin: true,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(ctx.displayRole, "student");
  assert.equal(ctx.capabilities.canStudyCourse, true);
  assert.equal(ctx.capabilities.canTeachCourse, false);
});

test("ROLE-07 superadmin + org teacher -> Docente, teaching", () => {
  const ctx = resolveCourseContext({
    orgRole: "teacher",
    courseRole: null,
    isSuperAdmin: true,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "teacher");
  assert.equal(ctx.capabilities.canTeachCourse, true);
});

test("ROLE-08 null/unknown no admin -> none, fail closed", () => {
  const ctx = resolveCourseContext({ orgRole: null, courseRole: null });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.NONE);
  assert.equal(ctx.displayRole, null);
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), null);
  assert.deepEqual([...courseTabIdsForMode(ctx.mode)], []);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(ctx.capabilities.canStudyCourse, false);
});

test("ROLE-09 preferred_role=teacher only -> no teaching permission", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: null,
    preferredRole: "teacher",
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.NONE);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: null }), false);
});

test("ROLE-10 same user teacher in course A and student in B -> role changes by context", () => {
  const asTeacher = resolveCourseContext({ orgRole: null, courseRole: "teacher" });
  const asStudent = resolveCourseContext({ orgRole: null, courseRole: "student" });
  assert.equal(asTeacher.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(asTeacher.displayRole, "co_teacher");
  assert.equal(asStudent.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(asStudent.displayRole, "student");
  assert.notEqual(asTeacher.mode, asStudent.mode);
});

test("ROLE-11 /dashboard/classes mixed roles -> no forced current-role badge", () => {
  // Pantalla ambigua: no hay contexto de curso → no inventar displayRole
  assert.equal(formatCurrentRoleLabel(null, tEs), null);
  assert.equal(formatCurrentRoleLabel(undefined, tEs), null);

  const home = readSrc("src/pages/PyBotClassPage.jsx");
  assert.doesNotMatch(home, /contextualRoleLabel/);
  assert.doesNotMatch(home, /formatCurrentRoleLabel/);
  assert.doesNotMatch(home, /pcCurrentRole|pcYourRole/);

  const topbar = readSrc("src/components/pybotclass/layout/PyBotClassTopbar.jsx");
  assert.match(topbar, /contextualRoleLabel/);
  assert.match(topbar, /contextualRoleCompact/);
  // Solo muestra badge si hay label (no inventa "—")
  assert.match(topbar, /contextualRoleLabel \?/);
  assert.match(topbar, /pbc-topbar__role-full/);
  assert.match(topbar, /pbc-topbar__role-compact/);
  assert.match(topbar, /aria-label=\{contextualRoleLabel\}/);
  assert.doesNotMatch(topbar, /Rol actual: —|Tu rol: —|Your role: —/);
  assert.doesNotMatch(topbar, /contextualRoleLabel\.split|substring|slice\(.*pcCurrentRole/);
});

test("formatCurrentRoleCompact es independiente de la etiqueta full (no parsea strings)", () => {
  assert.equal(formatCurrentRoleCompact("teacher", tEs), "Docente");
  assert.equal(formatCurrentRoleCompact("co_teacher", tEs), "Co-docente");
  assert.equal(formatCurrentRoleCompact("student", tEs), "Alumno");
  assert.equal(formatCurrentRoleCompact("superadmin", tEs), "Superadmin");
  assert.equal(formatCurrentRoleCompact(null, tEs), null);
  assert.equal(formatCurrentRoleCompact(undefined, tEs), null);
  // Contrato: compact usa courseDisplayRoleI18nKey + translate, no el string full
  assert.notEqual(formatCurrentRoleCompact("teacher", tEs), formatCurrentRoleLabel("teacher", tEs));
  assert.equal(
    formatCurrentRoleLabel("teacher", tEs),
    `${tEs("pcCurrentRole")} ${formatCurrentRoleCompact("teacher", tEs)}`,
  );
});

test("capacidades trusted: platform/org/study/grade/roster", () => {
  assert.equal(canManagePlatform({ isSuperAdmin: true }), true);
  assert.equal(canManagePlatform({ isSuperAdmin: false }), false);
  assert.equal(canManageOrganization({ orgRole: "owner" }), true);
  assert.equal(canManageOrganization({ orgRole: "teacher" }), false);
  assert.equal(canStudyCourse({ courseRole: "student" }), true);
  assert.equal(canStudyCourse({ courseRole: "teacher" }), false);
  assert.equal(canGradeCourse({ orgRole: "teacher" }), true);
  assert.equal(canManageRoster({ courseRole: "teacher" }), true);
  assert.equal(canGradeCourse({ courseRole: "student" }), false);
});

test("superadmin no se mapea automáticamente a Docente", () => {
  const ctx = resolveCourseContext({ isSuperAdmin: true });
  assert.notEqual(ctx.displayRole, "teacher");
  assert.notEqual(ctx.displayRole, "co_teacher");
  assert.equal(ctx.displayRole, "superadmin");
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.ADMIN);
});

test("courseDisplayRoleI18nKey y formatCurrentRoleLabel no usan —", () => {
  assert.equal(courseDisplayRoleI18nKey("teacher"), "pcTeacher");
  assert.equal(courseDisplayRoleI18nKey(null), null);
  assert.equal(formatCurrentRoleLabel(null, tEs), null);
  assert.doesNotMatch(formatCurrentRoleLabel("teacher", tEs) || "", /—/);
});

test("tabs por modo: admin no cae en STUDENT_TABS", () => {
  assert.deepEqual([...courseTabIdsForMode("teaching")], [
    "resumen",
    "actividades",
    "alumnos",
    "entregas",
    "notas",
    "integraciones",
  ]);
  assert.deepEqual([...courseTabIdsForMode("studying")], ["resumen", "actividades", "notas"]);
  assert.deepEqual([...courseTabIdsForMode("admin")], ["resumen", "actividades"]);
  assert.deepEqual([...courseTabIdsForMode("none")], []);
});

test("gating UI: sin ternarios binarios canTeach/isStudent en página y tabs", () => {
  const page = readSrc("src/pages/PyBotClassCoursePage.jsx");
  assert.match(page, /resolveCourseContext/);
  assert.match(page, /courseTabIdsForMode|tabsForMode/);
  assert.match(page, /formatCurrentRoleLabel/);
  assert.doesNotMatch(page, /canTeach\s*\?\s*TEACHER_TABS\s*:\s*STUDENT_TABS/);
  assert.doesNotMatch(page, /pcYourRole/);
  assert.doesNotMatch(page, /roleDisplay/);
  assert.doesNotMatch(page, /Tu rol:/);

  const activities = readSrc("src/components/pybotclass/CourseActivitiesTab.jsx");
  assert.match(activities, /COURSE_ACCESS_MODES/);
  assert.match(activities, /mode === COURSE_ACCESS_MODES\.STUDYING/);
  assert.match(activities, /mode === COURSE_ACCESS_MODES\.ADMIN/);
  assert.doesNotMatch(activities, /if\s*\(\s*isStudent\s*\)/);
  assert.doesNotMatch(activities, /canTeach\s*\?\s*/);

  const summary = readSrc("src/components/pybotclass/CourseSummaryTab.jsx");
  assert.match(summary, /COURSE_ACCESS_MODES/);
  assert.match(summary, /mode === COURSE_ACCESS_MODES\.STUDYING/);
  assert.doesNotMatch(summary, /canTeach\s*\?\s*fetchPybotclassCourseSummary\s*:\s*fetchPybotclassStudentSummary/);
  assert.doesNotMatch(summary, /if\s*\(\s*!canTeach\s*\)/);
});

test("gating: alumno sin controles teacher; teacher con controles; admin read-only", () => {
  const activities = readSrc("src/components/pybotclass/CourseActivitiesTab.jsx");
  // Controles teacher solo en rama teaching (después de early-return studying/admin)
  const studyingIdx = activities.indexOf("COURSE_ACCESS_MODES.STUDYING");
  const adminIdx = activities.indexOf("COURSE_ACCESS_MODES.ADMIN");
  const newBtnIdx = activities.indexOf('+ {t("pcNew")}');
  const editIdx = activities.indexOf('t("pcEdit")');
  const reviewIdx = activities.indexOf('t("pcReview")');
  const importIdx = activities.indexOf('t("pcImportClassroom")');
  assert.ok(studyingIdx > 0);
  assert.ok(adminIdx > studyingIdx);
  assert.ok(newBtnIdx > adminIdx, "+ Nueva solo después de rama admin");
  assert.ok(editIdx > adminIdx);
  assert.ok(reviewIdx > adminIdx);
  assert.ok(importIdx > adminIdx);

  const summary = readSrc("src/components/pybotclass/CourseSummaryTab.jsx");
  assert.match(summary, /pcYourProgress/);
  assert.match(summary, /pcClassSummary/);
  assert.match(summary, /pcAdminReadOnly/);
  // student progress solo en rama studying
  const progIdx = summary.indexOf('t("pcYourProgress")');
  const studyingBranch = summary.indexOf("COURSE_ACCESS_MODES.STUDYING");
  assert.ok(progIdx > studyingBranch);
});
