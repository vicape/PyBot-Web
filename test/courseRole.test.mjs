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

test("org owner/teacher puede enseñar curso sin membership student explícita", () => {
  assert.equal(canTeachCourse({ orgRole: "owner", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "unknown" }), true);
});

test("course_members.teacher u owner puede enseñar su curso", () => {
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "owner" }), true);
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "teacher" }), true);
});

test("alumno no puede enseñar (incl. org staff con course student explícito)", () => {
  assert.equal(canTeachCourse({ orgRole: "student", courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: "owner", courseRole: "student" }), false);
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

test("personal course creator + explicit teacher => displayRole teacher", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: "teacher",
    isPersonalCourseCreator: true,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "teacher");
  assert.equal(formatCurrentRoleLabel(ctx.displayRole, tEs), "Rol actual: Docente");
  assert.equal(ctx.capabilities.canTeachCourse, true);
  assert.equal(ctx.capabilities.canGradeCourse, true);
  assert.equal(ctx.capabilities.canManageRoster, true);
});

test("personal non-creator explicit teacher => co_teacher", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: "teacher",
    isPersonalCourseCreator: false,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "co_teacher");
  assert.equal(ctx.capabilities.canTeachCourse, true);
  assert.equal(ctx.capabilities.canGradeCourse, true);
  assert.equal(ctx.capabilities.canManageRoster, true);
});

test("personal course: explicit student still wins over isPersonalCourseCreator", () => {
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: "student",
    isPersonalCourseCreator: true,
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(ctx.displayRole, "student");
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(ctx.capabilities.canStudyCourse, true);
});

test("personal course flag does not change org staff display or capabilities", () => {
  const withFlag = resolveCourseContext({
    orgRole: "teacher",
    courseRole: null,
    isPersonalCourseCreator: true,
  });
  const withoutFlag = resolveCourseContext({
    orgRole: "teacher",
    courseRole: null,
    isPersonalCourseCreator: false,
  });
  assert.equal(withFlag.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(withFlag.displayRole, "teacher");
  assert.equal(withoutFlag.displayRole, "teacher");
  assert.equal(withFlag.capabilities.canTeachCourse, true);
  assert.equal(withFlag.capabilities.canGradeCourse, true);
  assert.equal(withFlag.capabilities.canManageRoster, true);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: null }), true);
  assert.equal(canGradeCourse({ orgRole: "teacher", courseRole: null }), true);
  assert.equal(canManageRoster({ orgRole: "teacher", courseRole: null }), true);
});

test("isPersonalCourseCreator is presentation-only: capabilities match without flag", () => {
  const creator = resolveCourseContext({
    orgRole: null,
    courseRole: "teacher",
    isPersonalCourseCreator: true,
  });
  const coTeacher = resolveCourseContext({
    orgRole: null,
    courseRole: "teacher",
    isPersonalCourseCreator: false,
  });
  assert.equal(creator.capabilities.canTeachCourse, coTeacher.capabilities.canTeachCourse);
  assert.equal(creator.capabilities.canGradeCourse, coTeacher.capabilities.canGradeCourse);
  assert.equal(creator.capabilities.canManageRoster, coTeacher.capabilities.canManageRoster);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canGradeCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(canManageRoster({ orgRole: null, courseRole: "teacher" }), true);
});

test("fetchCourseBasics includes created_by; page wires isPersonalCourseCreator", () => {
  const api = readSrc("src/platform/pybotClassApi.js");
  assert.match(api, /export async function fetchCourseBasics/);
  assert.match(
    api,
    /select\("id, title, org_id, created_by, classroom_course_id, organizations\(name\)"\)/,
  );

  const page = readSrc("src/pages/PyBotClassCoursePage.jsx");
  assert.match(page, /isPersonalCourseCreator/);
  assert.match(page, /course\?\.org_id == null/);
  assert.match(page, /course\?\.created_by === user\?\.id/);
  assert.match(page, /isPersonalCourseCreator/);
  assert.doesNotMatch(page, /preferred_role|preferredRole/);
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
  // profiles.preferred_role / signup role must not grant permissions
  const ctx = resolveCourseContext({
    orgRole: null,
    courseRole: null,
    preferredRole: "teacher",
  });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.NONE);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: null }), false);
  assert.equal(
    resolveCourseContext({ preferredRole: "teacher" }).mode,
    "none",
    "profiles.preferred_role must not be the effective role resolver",
  );
});

test("ROLE-10 same user teacher in course A and student in B -> role changes by context", () => {
  // Sin org staff: co-docente vs alumno
  const asCoTeacher = resolveCourseContext({ orgRole: null, courseRole: "teacher" });
  const asStudentOnly = resolveCourseContext({ orgRole: null, courseRole: "student" });
  assert.equal(asCoTeacher.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(asCoTeacher.displayRole, "co_teacher");
  assert.equal(asStudentOnly.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(asStudentOnly.displayRole, "student");
  assert.notEqual(asCoTeacher.mode, asStudentOnly.mode);

  // Misma institución: org teacher + course teacher en A, course student en B
  const courseA = resolveCourseContext({ orgRole: "teacher", courseRole: "teacher" });
  const courseB = resolveCourseContext({ orgRole: "teacher", courseRole: "student" });
  assert.equal(courseA.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(courseA.displayRole, "teacher");
  assert.equal(courseA.capabilities.canTeachCourse, true);
  assert.equal(courseB.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(courseB.displayRole, "student");
  assert.equal(courseB.capabilities.canTeachCourse, false);
  assert.equal(courseB.capabilities.canStudyCourse, true);
  assert.notEqual(courseA.mode, courseB.mode);
});

test("AC1 org teacher + explicit course student -> studying only that course", () => {
  // Given organization_members.role exactly 'teacher' and course_members.role exactly 'student'
  const src = readSrc("src/platform/courseRole.js");
  assert.match(src, /organization_members\.role/);
  assert.match(src, /profiles\.preferred_role/);
  assert.match(src, /resolveCourseContext\(\.\.\.\)\.mode/);
  const ctx = resolveCourseContext({ orgRole: "teacher", courseRole: "student" });
  assert.equal(
    ctx.mode,
    COURSE_ACCESS_MODES.STUDYING,
    "resolveCourseContext(...).mode must be exactly studying",
  );
  assert.equal(resolveCourseContext({ orgRole: "teacher", courseRole: "student" }).mode, "studying");
  assert.equal(ctx.displayRole, "student");
  assert.equal(ctx.capabilities.canStudyCourse, true);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(ctx.capabilities.canGradeCourse, false);
  assert.equal(ctx.capabilities.canManageRoster, false);
  assert.deepEqual([...courseTabIdsForMode(ctx.mode)], ["resumen", "actividades", "notas"]);
  assert.ok(!courseTabIdsForMode(ctx.mode).includes("alumnos"));
  assert.ok(!courseTabIdsForMode(ctx.mode).includes("entregas"));
  assert.ok(!courseTabIdsForMode(ctx.mode).includes("integraciones"));
});

test("AC2 org teacher + no course membership -> teaching preserved", () => {
  // PRESERVE: without course_members.role student, organization_members.role teacher keeps teaching
  // PRESERVE list: AC2 institution teacher teaching access; AC12 staff without explicit course membership;
  // PRESERVE: existing co-teacher; invitation/Classroom membership; fail-closed unknown roles.
  const ctx = resolveCourseContext({ orgRole: "teacher", courseRole: null });
  assert.equal(
    resolveCourseContext({ orgRole: "teacher", courseRole: null }).mode,
    "teaching",
    "resolveCourseContext(...).mode must remain teaching when no explicit student",
  );
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(ctx.displayRole, "teacher");
  assert.equal(ctx.capabilities.canTeachCourse, true);
  assert.equal(ctx.capabilities.canStudyCourse, false);
});

test("AC3 explicit course teacher -> teaching (co-teacher without org staff)", () => {
  // course_members.role exactly 'teacher' -> resolveCourseContext(...).mode teaching
  const ctx = resolveCourseContext({ orgRole: null, courseRole: "teacher" });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(resolveCourseContext({ orgRole: null, courseRole: "teacher" }).mode, "teaching");
  assert.equal(ctx.displayRole, "co_teacher");
  assert.equal(ctx.capabilities.canTeachCourse, true);
});

test("AC4/AC7 org owner + explicit course student: management intact, no pedagogical teacher", () => {
  // organization_members.role owner + course_members.role student: management ≠ pedagogical teaching
  const ctx = resolveCourseContext({ orgRole: "owner", courseRole: "student" });
  assert.equal(ctx.mode, COURSE_ACCESS_MODES.STUDYING);
  assert.equal(resolveCourseContext({ orgRole: "owner", courseRole: "student" }).mode, "studying");
  assert.equal(ctx.displayRole, "student");
  assert.equal(ctx.capabilities.canManageOrganization, true);
  assert.equal(ctx.capabilities.canTeachCourse, false);
  assert.equal(ctx.capabilities.canGradeCourse, false);
  assert.equal(ctx.capabilities.canManageRoster, false);
  assert.equal(ctx.capabilities.canStudyCourse, true);
});

test("AC11 unknown course role no se convierte en student ni teacher", () => {
  assert.equal(normalizeCourseRole("admin"), null);
  assert.equal(normalizeCourseRole(null), null);
  const noStaff = resolveCourseContext({ orgRole: null, courseRole: "admin" });
  assert.equal(noStaff.mode, COURSE_ACCESS_MODES.NONE);
  assert.equal(noStaff.displayRole, null);
  assert.equal(noStaff.capabilities.canTeachCourse, false);
  assert.equal(noStaff.capabilities.canStudyCourse, false);
  // Sin membership pedagógica conocida, staff org conserva teaching (no inventa student)
  const staffUnknown = resolveCourseContext({ orgRole: "teacher", courseRole: "admin" });
  assert.equal(staffUnknown.mode, COURSE_ACCESS_MODES.TEACHING);
  assert.equal(staffUnknown.capabilities.canTeachCourse, true);
  assert.equal(staffUnknown.capabilities.canStudyCourse, false);
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
  assert.equal(canGradeCourse({ orgRole: "teacher", courseRole: "student" }), false);
  assert.equal(canManageRoster({ orgRole: "owner", courseRole: "student" }), false);
});

test("AC6 backend is_course_teacher matches frontend explicit-student precedence", () => {
  const mig = readSrc(
    "supabase/migrations/20260930210055_is_course_teacher_explicit_student.sql",
  );
  assert.ok(
    mig.includes("public.is_course_teacher()"),
    "migration must reference public.is_course_teacher()",
  );
  assert.match(mig, /create or replace function public\.is_course_teacher/);
  assert.match(mig, /is_course_org_staff/);
  assert.match(mig, /cm\.role = 'student'/);
  assert.match(mig, /cm\.role = 'teacher'/);
  assert.match(mig, /and not exists/);
  assert.match(mig, /course_members/);
  // Semántica alineada con resolveCourseContext(...).mode: org teacher + course student => studying / no teach
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: "student" }), false);
  assert.equal(canTeachCourse({ orgRole: "teacher", courseRole: null }), true);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: "teacher" }), true);
  assert.equal(resolveCourseContext({ orgRole: "teacher", courseRole: "student" }).mode, "studying");
  assert.equal(resolveCourseContext({ orgRole: "teacher", courseRole: null }).mode, "teaching");
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
  const newBtnIdx = activities.indexOf('t("pcCreateActivity")');
  const editIdx = activities.indexOf('t("pcEdit")');
  const reviewIdx = activities.indexOf('t("pcReview")');
  const importIdx = activities.indexOf('t("pcImportClassroom")');
  assert.ok(studyingIdx > 0);
  assert.ok(adminIdx > studyingIdx);
  assert.ok(newBtnIdx > adminIdx, "Crear actividad solo después de rama admin");
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
