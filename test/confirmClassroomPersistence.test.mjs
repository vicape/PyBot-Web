import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmClassroomPersistence } from "../src/platform/confirmClassroomPersistence.js";

test("P2/P16 serverPersisted confirma vía organization_classroom_links (sin RT)", async () => {
  const r = await confirmClassroomPersistence(
    {
      userId: "u1",
      mode: "teacher",
      orgId: "org-1",
      serverPersisted: true,
      source: "vault",
    },
    {
      fetchOrganizationClassroomLink: async () => ({
        ok: true,
        linkedAt: "2026-01-01T00:00:00Z",
      }),
      getStoredClassroomLinkMeta: async () => {
        throw new Error("should_not_need_legacy");
      },
      getStoredStudentClassroomLink: async () => {
        throw new Error("should_not_need_student");
      },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.source, "vault");
});

test("P2/P16 legacy profiles_legacy confirma con metadata linked_at", async () => {
  const r = await confirmClassroomPersistence(
    {
      userId: "u1",
      mode: "teacher",
      orgId: "org-1",
      serverPersisted: true,
      source: "profiles_legacy",
    },
    {
      fetchOrganizationClassroomLink: async () => ({ ok: false, linkedAt: null }),
      getStoredClassroomLinkMeta: async () => ({
        classroom_linked_at: "2026-01-01T00:00:00Z",
      }),
      getStoredStudentClassroomLink: async () => null,
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.source, "profiles_legacy");
});

test("P2 student: metadata student linked_at", async () => {
  const r = await confirmClassroomPersistence(
    {
      userId: "u2",
      mode: "student",
      orgId: "org-1",
      serverPersisted: true,
      source: "profiles_legacy",
    },
    {
      fetchOrganizationClassroomLink: async () => ({ ok: false, linkedAt: null }),
      getStoredClassroomLinkMeta: async () => null,
      getStoredStudentClassroomLink: async () => ({
        classroom_student_linked_at: "2026-01-01T00:00:00Z",
      }),
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.source, "profiles_legacy");
});

test("P2 sin serverPersisted falla", async () => {
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", orgId: "org-1", serverPersisted: false },
    {
      fetchOrganizationClassroomLink: async () => ({
        ok: true,
        linkedAt: "2026-01-01T00:00:00Z",
      }),
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "server_persist_required");
});

test("P2 sin metadata falla persist_unconfirmed", async () => {
  const r = await confirmClassroomPersistence(
    {
      userId: "u1",
      mode: "teacher",
      orgId: "org-1",
      serverPersisted: true,
      source: "vault",
    },
    {
      fetchOrganizationClassroomLink: async () => ({ ok: false, linkedAt: null }),
      getStoredClassroomLinkMeta: async () => ({ classroom_linked_at: null }),
      getStoredStudentClassroomLink: async () => null,
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_unconfirmed");
});

test("P2 no usa saveGoogleTokens ni lee RT", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/platform/confirmClassroomPersistence.js", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /saveGoogleTokens/);
  assert.doesNotMatch(src, /getStoredGoogleRefreshToken/);
  assert.doesNotMatch(src, /refreshToken/);
  assert.doesNotMatch(src, /google_refresh_token/);
});

test("P1 intacto: classroomToken no usa client secret ni oauth directo", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/platform/classroomToken.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /VITE_GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(src, /oauth2\.googleapis\.com\/token/);
  assert.match(src, /\/api\/refresh-classroom-token/);
});
