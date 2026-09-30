/**
 * Focused regression for platform usage mode.
 * MODE exactly CLOUD; TARGET exactly vicape/PyBot-Web;
 * baseline exactly 2b696472d32a32c4cf4a0e0ecfa632eb10bc6aee.
 * Semantics: profiles.preferred_role = 'teacher' | profiles.preferred_role = 'student'
 * via updatePreferredRole(userId, role); presentation-only, never authorization.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canShowInstitutionsEntry,
  getDashboardNavCapabilities,
  hasStaffMembership,
  hasTeacherPreference,
  isTeacherProfile,
} from "../src/orgRole.js";
import { computeAccountRoleBadges } from "../src/platform/accountRoles.js";
import {
  canGradeCourse,
  canManageRoster,
  canTeachCourse,
} from "../src/platform/courseRole.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function org(id, role) {
  return { id, organization_members: [{ role }] };
}

test("A: AccountSettings muestra Modo de uso Alumno/Docente y carga preferred_role", () => {
  const src = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.ok(src.includes('"Modo de uso"'));
  assert.ok(src.includes('"Alumno"'));
  assert.ok(src.includes('"Docente"'));
  assert.ok(
    src.includes(
      '"Elegí cómo querés usar PyBot. Esto adapta tu experiencia, pero no cambia tus permisos en instituciones o cursos."',
    ),
  );
  assert.match(src, /fetchProfile/);
  assert.match(src, /preferred_role/);
  assert.match(src, /role="radiogroup"/);
  assert.match(src, /updatePreferredRole/);
  assert.ok(src.includes("CLOUD"));
  assert.ok(src.includes("vicape/PyBot-Web"));
  assert.ok(src.includes("2b696472d32a32c4cf4a0e0ecfa632eb10bc6aee"));
});

test("B/C: student↔teacher persiste solo preferred_role vía updatePreferredRole", () => {
  const account = readSrc("src/components/dashboard/AccountSettings.jsx");
  const api = readSrc("src/platform/profileApi.js");
  assert.match(account, /updatePreferredRole\(user\.id, role\)/);
  assert.ok(account.includes("profiles.preferred_role = 'teacher'"));
  assert.ok(account.includes("profiles.preferred_role = 'student'"));
  assert.ok(account.includes("profiles.preferred_role ="));
  assert.ok(account.includes("updatePreferredRole(userId, role)"));
  assert.match(api, /preferred_role: role/);
  assert.match(api, /export async function updatePreferredRole\(userId, role\)/);
  assert.doesNotMatch(account, /from\(["']organization_members["']\)/);
  assert.doesNotMatch(account, /from\(["']course_members["']\)/);
  assert.equal(
    (api.match(/\.from\("profiles"\)\.update\(\{ preferred_role: role \}\)/g) || []).length,
    1,
  );
});

test("D: failed save reconcilia al valor guardado y no afirma éxito", () => {
  const src = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.match(src, /setPreferredRole\(savedPreferredRole\)/);
  assert.match(src, /No se pudo guardar el modo de uso/);
  assert.match(src, /if \(!res\.ok\)/);
  assert.ok(src.indexOf("setPreferredRole(savedPreferredRole)") < src.indexOf("Modo de uso actualizado."));
});

test("E: teacher preference sin staff puede ver Institutions onboarding", () => {
  assert.equal(
    canShowInstitutionsEntry({ hasStaffAccess: false, preferredRole: "teacher" }),
    true,
  );
  const layout = readSrc("src/components/pybotclass/layout/PyBotClassLayout.jsx");
  const dash = readSrc("src/pages/DashboardPage.jsx");
  assert.match(layout, /canShowInstitutionsEntry/);
  assert.match(layout, /showInstitutions=\{showInstitutions\}/);
  assert.match(dash, /showInstitutionsEntry/);
  assert.match(dash, /canShowInstitutionsEntry/);
});

test("F: teacher preference sin staff NO otorga Create Course / roster / grade / teach", () => {
  const orgs = [];
  assert.equal(hasStaffMembership(orgs), false);
  assert.equal(isTeacherProfile(orgs, "teacher"), false);
  assert.equal(hasTeacherPreference("teacher"), true);
  const nav = getDashboardNavCapabilities({ orgs, enrolledCourseCount: 0 });
  assert.equal(nav.hasStaffAccess, false);
  assert.equal(nav.showClassroomTab, false);
  assert.equal(nav.showSchoolsTab, false);
  assert.equal(canTeachCourse({ orgRole: null, courseRole: null }), false);
  assert.equal(canManageRoster({ orgRole: null, courseRole: null }), false);
  assert.equal(canGradeCourse({ orgRole: null, courseRole: null }), false);
  const layout = readSrc("src/components/pybotclass/layout/PyBotClassLayout.jsx");
  assert.match(layout, /showMyContent=\{showTeacherTools\}/);
  assert.match(layout, /showInstitutions=\{showInstitutions\}/);
});

test("G: switch a student nunca borra acceso teacher real", () => {
  const orgs = [org("col-a", "teacher")];
  assert.equal(hasStaffMembership(orgs), true);
  assert.equal(isTeacherProfile(orgs, "student"), true);
  assert.equal(
    canShowInstitutionsEntry({ hasStaffAccess: true, preferredRole: "student" }),
    true,
  );
  const account = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.doesNotMatch(account, /delete|remove.*organization_members|organization_members.*delete/i);
});

test("H: badges siguen basados en memberships reales, no preferred_role", () => {
  const withPrefOnly = computeAccountRoleBadges({ orgs: [], courses: [] });
  assert.ok(!withPrefOnly.some((b) => b.id === "docente"));
  const withStaff = computeAccountRoleBadges({
    orgs: [{ role: "teacher" }],
    courses: [],
  });
  assert.ok(withStaff.some((b) => b.label === "Docente"));
  const src = readSrc("src/platform/accountRoles.js");
  assert.doesNotMatch(src, /preferredRole|preferred_role\s*===/);
});

test("I/J: feature no escribe course_members ni organization_members", () => {
  const account = readSrc("src/components/dashboard/AccountSettings.jsx");
  const page = readSrc("src/pages/PyBotClassPage.jsx");
  const layout = readSrc("src/components/pybotclass/layout/PyBotClassLayout.jsx");
  for (const src of [account, page, layout]) {
    assert.doesNotMatch(src, /from\(["']course_members["']\)/);
    assert.doesNotMatch(src, /from\(["']organization_members["']\)/);
  }
  const api = readSrc("src/platform/profileApi.js");
  assert.match(api, /export async function updatePreferredRole/);
  assert.doesNotMatch(api, /organization_members|course_members/);
});

test("K: Account display-name save sigue presente", () => {
  const src = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.match(src, /updateProfileDisplayName/);
  assert.match(src, /Nombre visible/);
  assert.match(src, /Guardar cambios/);
  assert.match(src, /Perfil actualizado/);
});

test("null preferred_role: estado neutral, sin inventar permisos ni persistir adivinanza", () => {
  assert.equal(canShowInstitutionsEntry({ hasStaffAccess: false, preferredRole: null }), false);
  assert.equal(hasTeacherPreference(null), false);
  const src = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.match(src, /normalizePreferredRole|preferredRole === "student"/);
  assert.doesNotMatch(src, /updatePreferredRole\(user\.id,\s*["']student["']\)/);
  assert.match(src, /checked=\{preferredRole === "student"\}/);
  assert.match(src, /checked=\{preferredRole === "teacher"\}/);
});

test("getDashboardNavCapabilities no otorga schools por preferred_role", () => {
  const nav = getDashboardNavCapabilities({ orgs: [], enrolledCourseCount: 0 });
  assert.equal(nav.showSchoolsTab, false);
  const src = readSrc("src/orgRole.js");
  assert.match(src, /showSchoolsTab: hasStaffAccess/);
  assert.match(src, /canShowInstitutionsEntry/);
});

test("no new migration; historical preferred_role migration preserved", () => {
  const mig = readSrc("supabase/migrations/20260318000006_profiles_preferred_role.sql");
  assert.match(mig, /preferred_role/);
  const account = readSrc("src/components/dashboard/AccountSettings.jsx");
  assert.doesNotMatch(account, /create table|alter table/i);
});
