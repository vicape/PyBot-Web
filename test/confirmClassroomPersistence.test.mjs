import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmClassroomPersistence } from "../src/platform/confirmClassroomPersistence.js";

function apiMock(overrides = {}) {
  return {
    saveGoogleTokens: async () => ({ ok: true, skipped: false }),
    saveStudentGoogleTokens: async () => ({ ok: true, skipped: false }),
    getStoredGoogleRefreshToken: async () => ({ google_refresh_token: "RT_TEACHER" }),
    getStoredStudentGoogleRefreshToken: async () => "RT_STUDENT",
    markClassroomLinked: async () => ({ ok: true, skipped: false }),
    markStudentClassroomLinked: async () => ({ ok: true, skipped: false }),
    ...overrides,
  };
}

test("P2 teacher: éxito solo tras save + readback + mark", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT_TEACHER", expiresIn: 3600 },
    apiMock({
      markClassroomLinked: async () => {
        marked = true;
        return { ok: true, skipped: false };
      },
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(marked, true);
});

test("P2 teacher: save ok:false no marca vinculado", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT", expiresIn: 3600 },
    apiMock({
      saveGoogleTokens: async () => ({ ok: false, error: "db" }),
      markClassroomLinked: async () => {
        marked = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_failed");
  assert.equal(marked, false);
});

test("P2 teacher: skipped:true no es persistencia válida", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT", expiresIn: 3600 },
    apiMock({
      saveGoogleTokens: async () => ({ ok: true, skipped: true }),
      markClassroomLinked: async () => {
        marked = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_skipped");
  assert.equal(marked, false);
});

test("P2 teacher: sin refresh token falla", async () => {
  let saved = false;
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "", expiresIn: 3600 },
    apiMock({
      saveGoogleTokens: async () => {
        saved = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "missing_refresh_token");
  assert.equal(saved, false);
});

test("P2 teacher: readback distinto no marca vinculado", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT_A", expiresIn: 3600 },
    apiMock({
      getStoredGoogleRefreshToken: async () => ({ google_refresh_token: "RT_B" }),
      markClassroomLinked: async () => {
        marked = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_unconfirmed");
  assert.equal(marked, false);
});

test("P2 teacher: mark skipped:true falla", async () => {
  const r = await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT_TEACHER", expiresIn: 3600 },
    apiMock({
      markClassroomLinked: async () => ({ ok: true, skipped: true }),
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "link_skipped");
});

test("P2 student: save ok:false no marca vinculado", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u2", mode: "student", refreshToken: "RT_S", expiresIn: 3600 },
    apiMock({
      saveStudentGoogleTokens: async () => ({ ok: false, error: "db" }),
      markStudentClassroomLinked: async () => {
        marked = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_failed");
  assert.equal(marked, false);
});

test("P2 student: skipped:true no es válido", async () => {
  let marked = false;
  const r = await confirmClassroomPersistence(
    { userId: "u2", mode: "student", refreshToken: "RT_S", expiresIn: 3600 },
    apiMock({
      saveStudentGoogleTokens: async () => ({ ok: true, skipped: true }),
      markStudentClassroomLinked: async () => {
        marked = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, "persist_skipped");
  assert.equal(marked, false);
});

test("P2 student: éxito tras save + readback + mark", async () => {
  const r = await confirmClassroomPersistence(
    { userId: "u2", mode: "student", refreshToken: "RT_STUDENT", expiresIn: 3600 },
    apiMock(),
  );
  assert.equal(r.ok, true);
});

test("P2: teacher y student usan APIs separadas", async () => {
  let teacherSave = false;
  let studentSave = false;
  await confirmClassroomPersistence(
    { userId: "u1", mode: "teacher", refreshToken: "RT_TEACHER", expiresIn: 1 },
    apiMock({
      saveGoogleTokens: async () => {
        teacherSave = true;
        return { ok: true };
      },
      saveStudentGoogleTokens: async () => {
        studentSave = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(teacherSave, true);
  assert.equal(studentSave, false);

  teacherSave = false;
  studentSave = false;
  await confirmClassroomPersistence(
    { userId: "u2", mode: "student", refreshToken: "RT_STUDENT", expiresIn: 1 },
    apiMock({
      saveGoogleTokens: async () => {
        teacherSave = true;
        return { ok: true };
      },
      saveStudentGoogleTokens: async () => {
        studentSave = true;
        return { ok: true };
      },
    }),
  );
  assert.equal(teacherSave, false);
  assert.equal(studentSave, true);
});

test("P1 intacto: classroomToken no usa client secret ni oauth directo", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/platform/classroomToken.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /VITE_GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(src, /oauth2\.googleapis\.com\/token/);
  assert.match(src, /\/api\/refresh-classroom-token/);
});
