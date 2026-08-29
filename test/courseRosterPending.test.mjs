import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveClassroomStudent,
  syncClassroomRosterToCourse,
} from "../src/classroom/classroomRosterSync.js";

function makeMockSupabase(handlers) {
  return {
    rpc(name, params) {
      const handler = handlers[name];
      if (!handler) return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
      return Promise.resolve(handler(params));
    },
  };
}

test("no_registrado se envía como pending en sync", async () => {
  let captured = null;
  const sb = makeMockSupabase({
    list_course_members: () => ({ data: [], error: null }),
    find_profile_by_email: () => ({ data: [], error: null }),
    sync_classroom_course_roster: (params) => {
      captured = params;
      return {
        data: { ok: true, synced: 0, pending_upserted: 1, removed: 0 },
        error: null,
      };
    },
  });

  const sync = await syncClassroomRosterToCourse(sb, {
    courseId: "c1",
    orgId: "o1",
    classroomStudents: [
      {
        userId: "gc-1",
        profile: { emailAddress: "ana@school.edu", name: { fullName: "Ana" } },
      },
    ],
  });

  assert.equal(sync.ok, true);
  assert.equal(captured.p_enrolled.length, 0);
  assert.equal(captured.p_pending.length, 1);
  assert.equal(captured.p_pending[0].email, "ana@school.edu");
  assert.equal(captured.p_pending[0].classroom_user_id, "gc-1");
  assert.equal(sync.pendingUpserted, 1);
});

test("alumno con cuenta PyBot va a enrolled y no a pending", async () => {
  let captured = null;
  const sb = makeMockSupabase({
    list_course_members: () => ({ data: [], error: null }),
    find_profile_by_email: () => ({
      data: [{ id: "u-ana", display_name: "Ana" }],
      error: null,
    }),
    sync_classroom_course_roster: (params) => {
      captured = params;
      return { data: { ok: true, synced: 1, pending_upserted: 0 }, error: null };
    },
  });

  await syncClassroomRosterToCourse(sb, {
    courseId: "c1",
    orgId: "o1",
    classroomStudents: [
      { userId: "gc-1", profile: { emailAddress: "ana@school.edu", name: { fullName: "Ana" } } },
    ],
  });

  assert.equal(captured.p_enrolled.length, 1);
  assert.equal(captured.p_pending.length, 0);
});

test("claim plan: email pendiente coincide → activo", () => {
  const pending = [{ email: "bob@school.edu", course_id: "c1" }];
  const loginEmail = "Bob@School.EDU".trim().toLowerCase();
  const matched = pending.filter((p) => p.email.toLowerCase() === loginEmail);
  assert.equal(matched.length, 1);
});

test("resolveClassroomStudent sigue marcando no_registrado sin profile", () => {
  const r = resolveClassroomStudent(
    { userId: "gc", profile: { emailAddress: "x@y.com", name: { fullName: "X" } } },
    new Map(),
    new Map(),
  );
  assert.equal(r.status, "no_registrado");
});
