import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getDashboardNavCapabilities,
  getStaffOrganizations,
  getStudentOrganizations,
  hasStaffMembership,
  hasStudentMembership,
  hasTeacherPreference,
  resolveStaffOrgId,
} from "../src/orgRole.js";

function org(id, role) {
  return { id, organization_members: [{ role }] };
}

test("caso A multirol: teacher A + student B → ambas pestañas", () => {
  const orgs = [org("A", "teacher"), org("B", "student")];
  const nav = getDashboardNavCapabilities({ orgs, enrolledCourseCount: 1 });

  assert.equal(nav.hasStaffAccess, true);
  assert.equal(nav.hasStudentAccess, true);
  assert.equal(nav.showSchoolsTab, true);
  assert.equal(nav.showCoursesTab, true);
  assert.equal(nav.showClassroomTab, true);
  assert.deepEqual(
    getStaffOrganizations(orgs).map((o) => o.id),
    ["A"],
  );
  assert.deepEqual(
    getStudentOrganizations(orgs).map((o) => o.id),
    ["B"],
  );
});

test("caso B: solo student → Mis cursos, sin Colegios/Classroom", () => {
  const orgs = [org("A", "student")];
  const nav = getDashboardNavCapabilities({ orgs, enrolledCourseCount: 2 });

  assert.equal(nav.hasStaffAccess, false);
  assert.equal(nav.hasStudentAccess, true);
  assert.equal(nav.showSchoolsTab, false);
  assert.equal(nav.showCoursesTab, true);
  assert.equal(nav.showClassroomTab, false);
});

test("caso C: solo teacher → Colegios + Classroom", () => {
  const orgs = [org("A", "teacher")];
  const nav = getDashboardNavCapabilities({ orgs, enrolledCourseCount: 0 });

  assert.equal(nav.hasStaffAccess, true);
  assert.equal(nav.hasStudentAccess, false);
  assert.equal(nav.showSchoolsTab, true);
  assert.equal(nav.showCoursesTab, false);
  assert.equal(nav.showClassroomTab, true);
});

test("caso D: preferred teacher sin membership → sin staff, crear colegio OK", () => {
  const orgs = [];
  const preferredRole = "teacher";
  const nav = getDashboardNavCapabilities({ orgs, enrolledCourseCount: 0 });

  assert.equal(hasStaffMembership(orgs), false);
  assert.equal(nav.showClassroomTab, false);
  assert.equal(hasTeacherPreference(preferredRole), true);
});

test("caso E: student A + teacher B → staffOrgId = B", () => {
  const orgs = [org("A", "student"), org("B", "teacher")];
  assert.equal(resolveStaffOrgId(orgs), "B");
});

test("hasStudentMembership no se infiere por ausencia de staff", () => {
  assert.equal(hasStudentMembership([]), false);
  assert.equal(hasStudentMembership([org("x", "teacher")]), false);
  assert.equal(hasStudentMembership([org("x", "student")]), true);
});

test("alumno con cursos inscritos sin org student explícita → Mis cursos", () => {
  const nav = getDashboardNavCapabilities({ orgs: [], enrolledCourseCount: 3 });
  assert.equal(nav.showCoursesTab, true);
  assert.equal(nav.showSchoolsTab, false);
});
