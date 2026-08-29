import { test } from "node:test";
import assert from "node:assert/strict";
import {
  joinPathAfterRedeem,
  joinSuccessMessage,
  planRedeemOrgInvite,
} from "../src/platform/redeemOrgInvitePlan.js";

const now = new Date("2026-08-29T12:00:00Z");

test("curso invite crea organización + course_member (alumno nuevo)", () => {
  const plan = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: "course-a",
      role: "student",
      expires_at: null,
      use_count: 0,
      max_uses: 100,
    },
    courseOrgId: "org-1",
    isOrgMember: false,
    isCourseMember: false,
    now,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.course_id, "course-a");
  assert.deepEqual(
    plan.actions.map((a) => a.type),
    ["insert_organization_member", "upsert_course_member", "increment_use_count"],
  );
  assert.equal(plan.actions[1].source, "invite");
  assert.equal(plan.actions[1].already, false);
});

test("miembro existente del colegio puede unirse al curso", () => {
  const plan = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: "course-a",
      role: "student",
      expires_at: null,
      use_count: 1,
      max_uses: 100,
    },
    courseOrgId: "org-1",
    isOrgMember: true,
    isCourseMember: false,
    now,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.error, undefined);
  assert.ok(!plan.actions.some((a) => a.type === "insert_organization_member"));
  assert.ok(plan.actions.some((a) => a.type === "upsert_course_member"));
});

test("miembro existente del curso no se duplica (upsert already)", () => {
  const plan = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: "course-a",
      role: "student",
      expires_at: null,
      use_count: 0,
      max_uses: 10,
    },
    courseOrgId: "org-1",
    isOrgMember: true,
    isCourseMember: true,
    now,
  });

  assert.equal(plan.ok, true);
  const upsert = plan.actions.find((a) => a.type === "upsert_course_member");
  assert.equal(upsert.already, true);
  assert.equal(plan.actions.filter((a) => a.type === "upsert_course_member").length, 1);
});

test("invitación general sigue funcionando y already_member si ya está", () => {
  const fresh = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: null,
      role: "student",
      expires_at: null,
      use_count: 0,
      max_uses: 1,
    },
    courseOrgId: null,
    isOrgMember: false,
    isCourseMember: false,
    now,
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.course_id, null);
  assert.ok(fresh.actions.some((a) => a.type === "insert_organization_member"));
  assert.ok(!fresh.actions.some((a) => a.type === "upsert_course_member"));

  const already = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: null,
      role: "student",
      expires_at: null,
      use_count: 0,
      max_uses: 1,
    },
    courseOrgId: null,
    isOrgMember: true,
    isCourseMember: false,
    now,
  });
  assert.equal(already.ok, false);
  assert.equal(already.error, "already_member");
});

test("curso de otra organización es rechazado", () => {
  const plan = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: "course-x",
      role: "student",
      expires_at: null,
      use_count: 0,
      max_uses: 5,
    },
    courseOrgId: "org-OTHER",
    isOrgMember: false,
    isCourseMember: false,
    now,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, "curso_invalido");
});

test("expiración y max_uses siguen funcionando", () => {
  const expired = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: "course-a",
      role: "student",
      expires_at: "2026-01-01T00:00:00Z",
      use_count: 0,
      max_uses: 10,
    },
    courseOrgId: "org-1",
    isOrgMember: false,
    isCourseMember: false,
    now,
  });
  assert.equal(expired.error, "expired");

  const maxed = planRedeemOrgInvite({
    invite: {
      org_id: "org-1",
      course_id: null,
      role: "student",
      expires_at: null,
      use_count: 3,
      max_uses: 3,
    },
    courseOrgId: null,
    isOrgMember: false,
    isCourseMember: false,
    now,
  });
  assert.equal(maxed.error, "max_uses");
});

test("joinPathAfterRedeem y mensaje de éxito según course_id", () => {
  assert.equal(
    joinPathAfterRedeem({ ok: true, org_id: "o1", course_id: "c1" }),
    "/dashboard/org/o1/course/c1",
  );
  assert.equal(joinPathAfterRedeem({ ok: true, org_id: "o1", course_id: null }), "/dashboard/org/o1");
  assert.equal(joinSuccessMessage({ course_id: "c1" }, () => "Alumno"), "Listo: te uniste al curso.");
  assert.equal(
    joinSuccessMessage({ course_id: null, role: "student" }, (r) => (r === "student" ? "Alumno" : r)),
    "Listo: te uniste como Alumno.",
  );
});
