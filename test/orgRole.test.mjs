import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasStaffMembership,
  hasTeacherPreference,
  isTeacherProfile,
  resolveStaffOrgId,
} from "../src/orgRole.js";

function org(id, role) {
  return { id, organization_members: [{ role }] };
}

test("caso 1: preferred teacher sin membresías → sin acceso staff", () => {
  const orgs = [];
  const preferredRole = "teacher";

  assert.equal(hasStaffMembership(orgs), false);
  assert.equal(isTeacherProfile(orgs, preferredRole), false);
  assert.equal(hasTeacherPreference(preferredRole), true);
  assert.equal(resolveStaffOrgId(orgs), null);
});

test("caso 2: preferred teacher con membresía student → sin acceso staff", () => {
  const orgs = [org("col-a", "student")];
  const preferredRole = "teacher";

  assert.equal(hasStaffMembership(orgs), false);
  assert.equal(isTeacherProfile(orgs, preferredRole), false);
  assert.equal(resolveStaffOrgId(orgs), null);
});

test("caso 3: preferred student con membresía teacher → acceso staff", () => {
  const orgs = [org("col-a", "teacher")];
  const preferredRole = "student";

  assert.equal(hasStaffMembership(orgs), true);
  assert.equal(isTeacherProfile(orgs, preferredRole), true);
  assert.equal(hasTeacherPreference(preferredRole), false);
});

test("caso 4: owner → acceso staff", () => {
  const orgs = [org("col-a", "owner")];

  assert.equal(hasStaffMembership(orgs), true);
  assert.equal(isTeacherProfile(orgs), true);
  assert.equal(resolveStaffOrgId(orgs), "col-a");
});

test("caso 5: staffOrgId elige colegio staff, no el primero si es student", () => {
  const orgs = [org("col-a", "student"), org("col-b", "teacher")];

  assert.equal(resolveStaffOrgId(orgs), "col-b");
  assert.equal(hasStaffMembership(orgs), true);
});

test("preferred_role no concede permisos aunque isTeacherProfile reciba el argumento", () => {
  assert.equal(isTeacherProfile([], "teacher"), false);
  assert.equal(isTeacherProfile([org("x", "student")], "teacher"), false);
});
