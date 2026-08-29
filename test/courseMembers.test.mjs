import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAllClassroomPages,
  listCourseStudents,
  listTeacherClassroomCourses,
} from "../src/classroom/classroomApi.js";
import {
  resolveClassroomStudent,
  summarizeClassroomSyncResults,
  syncClassroomRosterToCourse,
  classroomSyncErrorMessage,
} from "../src/classroom/classroomRosterSync.js";

// ─── Helpers que reflejan las reglas RLS de la migración 013 ───────────────

function canViewCourse({ orgRole, enrolledCourseIds, courseId }) {
  if (orgRole === "owner" || orgRole === "teacher") return true;
  return enrolledCourseIds.includes(courseId);
}

function canViewActivity({ orgRole, enrolledCourseIds, activityCourseId }) {
  if (orgRole === "owner" || orgRole === "teacher") return true;
  return enrolledCourseIds.includes(activityCourseId);
}

function makeMockSupabase(handlers) {
  return {
    rpc(name, params) {
      const handler = handlers[name];
      if (!handler) return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
      return Promise.resolve(handler(params));
    },
  };
}

// ─── 1-3: Acceso a cursos y actividades ─────────────────────────────────────

test("alumno de curso A NO ve curso B", () => {
  const enrolled = ["course-a"];
  assert.equal(canViewCourse({ orgRole: "student", enrolledCourseIds: enrolled, courseId: "course-a" }), true);
  assert.equal(canViewCourse({ orgRole: "student", enrolledCourseIds: enrolled, courseId: "course-b" }), false);
});

test("alumno de curso A NO ve actividades de B", () => {
  const enrolled = ["course-a"];
  assert.equal(canViewActivity({ orgRole: "student", enrolledCourseIds: enrolled, activityCourseId: "course-a" }), true);
  assert.equal(canViewActivity({ orgRole: "student", enrolledCourseIds: enrolled, activityCourseId: "course-b" }), false);
});

test("teacher puede ver cursos de su institución", () => {
  assert.equal(canViewCourse({ orgRole: "teacher", enrolledCourseIds: [], courseId: "any-course" }), true);
  assert.equal(canViewCourse({ orgRole: "owner", enrolledCourseIds: [], courseId: "any-course" }), true);
});

// ─── 4-9: Sincronización Classroom ──────────────────────────────────────────

test("resolveClassroomStudent: alumno sin PyBot queda no_registrado", () => {
  const result = resolveClassroomStudent(
    { userId: "gc-1", profile: { name: { fullName: "Ana" }, emailAddress: "ana@school.edu" } },
    new Map(),
    new Map(),
  );
  assert.equal(result.status, "no_registrado");
  assert.equal(result.email, "ana@school.edu");
  assert.equal(result.classroomUserId, "gc-1");
});

test("resolveClassroomStudent: resuelve por classroom_user_id antes que email", () => {
  const byClassroom = new Map([["gc-99", { user_id: "user-uuid-99" }]]);
  const result = resolveClassroomStudent(
    { userId: "gc-99", profile: { emailAddress: "other@school.edu" } },
    byClassroom,
    new Map([["other@school.edu", { id: "wrong-id" }]]),
  );
  assert.equal(result.status, "actualizado");
  assert.equal(result.userId, "user-uuid-99");
});

test("resolveClassroomStudent: resuelve por email si no hay classroom_user_id previo", () => {
  const result = resolveClassroomStudent(
    { userId: "gc-2", profile: { emailAddress: "Bob@School.EDU" } },
    new Map(),
    new Map([["bob@school.edu", { id: "user-bob" }]]),
  );
  assert.equal(result.status, "importado");
  assert.equal(result.userId, "user-bob");
});

test("import Classroom crea course_members vía RPC sync", async () => {
  const calls = [];
  const sb = makeMockSupabase({
    list_course_members: () => ({ data: [], error: null }),
    find_profile_by_email: () => ({
      data: [{ id: "user-1", display_name: "Carlos" }],
      error: null,
    }),
    sync_classroom_course_roster: (params) => {
      calls.push(params);
      return { data: { ok: true, synced: 1, removed: 0 }, error: null };
    },
  });

  const sync = await syncClassroomRosterToCourse(sb, {
    courseId: "course-1",
    orgId: "org-1",
    classroomStudents: [
      { userId: "gc-10", profile: { emailAddress: "carlos@school.edu", name: { fullName: "Carlos" } } },
    ],
  });

  assert.equal(sync.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_course_id, "course-1");
  assert.equal(calls[0].p_enrolled.length, 1);
  assert.equal(calls[0].p_enrolled[0].user_id, "user-1");
  assert.equal(calls[0].p_enrolled[0].classroom_user_id, "gc-10");
});

test("importar dos veces no duplica: RPC upsert idempotente", async () => {
  let syncCalls = 0;
  const sb = makeMockSupabase({
    list_course_members: () => ({
      data: [{ user_id: "user-1", role: "student", classroom_user_id: "gc-10", source: "classroom" }],
      error: null,
    }),
    sync_classroom_course_roster: (params) => {
      syncCalls += 1;
      return { data: { ok: true, synced: params.p_enrolled.length, removed: 0 }, error: null };
    },
  });

  const students = [{ userId: "gc-10", profile: { emailAddress: "carlos@school.edu" } }];
  const first = await syncClassroomRosterToCourse(sb, { courseId: "c1", orgId: "o1", classroomStudents: students });
  const second = await syncClassroomRosterToCourse(sb, { courseId: "c1", orgId: "o1", classroomStudents: students });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(syncCalls, 2);
  assert.equal(first.results[0].status, "actualizado");
  assert.equal(second.results[0].status, "actualizado");
});

test("alumno Classroom existente se actualiza (status actualizado)", async () => {
  const sb = makeMockSupabase({
    list_course_members: () => ({
      data: [{ user_id: "u-existing", role: "student", classroom_user_id: "gc-old" }],
      error: null,
    }),
    sync_classroom_course_roster: () => ({ data: { ok: true, synced: 1, removed: 0 }, error: null }),
  });

  const sync = await syncClassroomRosterToCourse(sb, {
    courseId: "c1",
    orgId: "o1",
    classroomStudents: [{ userId: "gc-old", profile: { emailAddress: "x@y.com" } }],
  });

  assert.equal(sync.ok, true);
  assert.equal(sync.results[0].status, "actualizado");
  assert.equal(sync.results[0].userId, "u-existing");
});

test("alumno retirado de Classroom se elimina solo de course_members", async () => {
  const sb = makeMockSupabase({
    list_course_members: () => ({ data: [], error: null }),
    sync_classroom_course_roster: (params) => {
      assert.deepEqual(params.p_enrolled, []);
      assert.deepEqual(params.p_active_classroom_user_ids, []);
      return { data: { ok: true, synced: 0, removed: 2 }, error: null };
    },
  });

  const sync = await syncClassroomRosterToCourse(sb, {
    courseId: "c1",
    orgId: "o1",
    classroomStudents: [],
  });

  assert.equal(sync.ok, true);
  assert.equal(sync.removed, 2);
});

test("sync no elimina organization_members (RPC solo gestiona course_members)", async () => {
  const sb = makeMockSupabase({
    list_course_members: () => ({ data: [], error: null }),
    find_profile_by_email: () => ({ data: [{ id: "u1" }], error: null }),
    sync_classroom_course_roster: (params) => {
      assert.ok("p_org_id" in params);
      assert.ok("p_enrolled" in params);
      assert.ok(!("remove_org_members" in params));
      return { data: { ok: true, synced: 1, org_added: 1, removed: 0 }, error: null };
    },
  });

  const sync = await syncClassroomRosterToCourse(sb, {
    courseId: "c1",
    orgId: "o1",
    classroomStudents: [{ userId: "gc-1", profile: { emailAddress: "a@b.com" } }],
  });

  assert.equal(sync.ok, true);
});

test("summarizeClassroomSyncResults cuenta estados correctamente", () => {
  const results = [
    { status: "importado" },
    { status: "actualizado" },
    { status: "no_registrado" },
    { status: "sin_email" },
  ];
  const s = summarizeClassroomSyncResults(results);
  assert.equal(s.imported, 1);
  assert.equal(s.updated, 1);
  assert.equal(s.noRegistrado, 1);
  assert.equal(s.sinEmail, 1);
  assert.equal(s.total, 4);
});

test("classroomSyncErrorMessage distingue errores críticos", () => {
  assert.match(classroomSyncErrorMessage({ code: "missing_access_token" }), /Classroom no conectado/);
  assert.match(classroomSyncErrorMessage({ status: 403 }), /Token de Classroom/);
  assert.match(classroomSyncErrorMessage({ code: "sin_permisos" }), /permisos/);
});

// ─── 10: Paginación Classroom ────────────────────────────────────────────────

test("fetchAllClassroomPages procesa más de una página", async () => {
  let call = 0;
  const items = await fetchAllClassroomPages(async (pageToken) => {
    call += 1;
    if (!pageToken) {
      return { items: [{ id: "a" }], nextPageToken: "page2" };
    }
    if (pageToken === "page2") {
      return { items: [{ id: "b" }], nextPageToken: null };
    }
    return { items: [], nextPageToken: null };
  });

  assert.equal(call, 2);
  assert.deepEqual(items, [{ id: "a" }, { id: "b" }]);
});

test("listCourseStudents usa paginación con nextPageToken", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = async (url) => {
    requests += 1;
    const hasToken = String(url).includes("pageToken=tok2");
    return {
      ok: true,
      async json() {
        if (!hasToken) {
          return { students: [{ userId: "s1" }], nextPageToken: "tok2" };
        }
        return { students: [{ userId: "s2" }] };
      },
    };
  };

  try {
    const students = await listCourseStudents("fake-token", "course-123");
    assert.equal(requests, 2);
    assert.equal(students.length, 2);
    assert.equal(students[0].userId, "s1");
    assert.equal(students[1].userId, "s2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTeacherClassroomCourses usa paginación con nextPageToken", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = async (url) => {
    requests += 1;
    const hasToken = String(url).includes("pageToken=next");
    return {
      ok: true,
      async json() {
        if (!hasToken) {
          return { courses: [{ id: "c1" }], nextPageToken: "next" };
        }
        return { courses: [{ id: "c2" }] };
      },
    };
  };

  try {
    const courses = await listTeacherClassroomCourses("fake-token");
    assert.equal(requests, 2);
    assert.equal(courses.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
