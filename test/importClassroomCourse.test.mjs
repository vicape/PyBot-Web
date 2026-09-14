import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClassroomImportPayload,
  importClassroomCourseToOrg,
  isClassroomIdInsertError,
  isSlugInsertError,
} from "../src/platform/importClassroomCourse.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mockSb({ existing = null, existingErr = null, inserts = [] } = {}) {
  let insertIdx = 0;
  return {
    from(table) {
      assert.equal(table, "courses");
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: existing, error: existingErr };
                    },
                  };
                },
              };
            },
          };
        },
        insert(payload) {
          const planned = inserts[insertIdx++] || { data: null, error: { message: "unexpected" } };
          return {
            select() {
              return {
                async maybeSingle() {
                  return {
                    data: planned.data,
                    error: planned.error,
                    _payload: payload,
                  };
                },
              };
            },
            _payload: payload,
          };
        },
      };
    },
  };
}

test("P6 payload requiere classroom_course_id y org", () => {
  assert.equal(
    buildClassroomImportPayload({
      orgId: "",
      classroomCourseId: "gc1",
      title: "A",
      userId: "u1",
    }),
    null,
  );
  const p = buildClassroomImportPayload({
    orgId: "org1",
    classroomCourseId: "gc1",
    title: "Matemática",
    userId: "u1",
    slug: "matematica",
  });
  assert.equal(p.classroom_course_id, "gc1");
  assert.equal(p.org_id, "org1");
});

test("P6 never strips classroom_course_id on error classification", () => {
  assert.equal(isClassroomIdInsertError({ message: "column classroom_course_id ..." }), true);
  assert.equal(isSlugInsertError({ message: "duplicate key slug" }), true);
  const panel = readFileSync(join(root, "src/components/dashboard/ClassroomPanel.jsx"), "utf8");
  assert.doesNotMatch(panel, /classroom_course_id:\s*_omitCl/);
  assert.doesNotMatch(panel, /withoutCl/);
  assert.match(panel, /importClassroomCourseToOrg/);
});

test("P6 import fails when insert cannot store classroom_course_id", async () => {
  const sb = mockSb({
    inserts: [{ data: null, error: { message: "Could not find column classroom_course_id" } }],
  });
  const r = await importClassroomCourseToOrg(sb, {
    orgId: "org1",
    classroomCourse: { id: "gc1", name: "A" },
    userId: "u1",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "classroom_id_required");
});

test("P6 import fails if row returns without classroom_course_id", async () => {
  const sb = mockSb({
    inserts: [{ data: { id: "c1", classroom_course_id: null }, error: null }],
  });
  const r = await importClassroomCourseToOrg(sb, {
    orgId: "org1",
    classroomCourse: { id: "gc1", name: "A" },
    userId: "u1",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "integrity_failed");
});

test("P6 slug retry keeps classroom_course_id", async () => {
  const payloads = [];
  const sb = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { async maybeSingle() { return { data: null, error: null }; } };
                },
              };
            },
          };
        },
        insert(payload) {
          payloads.push(payload);
          const n = payloads.length;
          return {
            select() {
              return {
                async maybeSingle() {
                  if (n === 1) {
                    return { data: null, error: { message: "duplicate key value violates unique constraint courses_slug" } };
                  }
                  return {
                    data: { id: "c9", classroom_course_id: "gc9" },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const r = await importClassroomCourseToOrg(sb, {
    orgId: "org1",
    classroomCourse: { id: "gc9", name: "Bio" },
    userId: "u1",
  });
  assert.equal(r.ok, true);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].classroom_course_id, "gc9");
  assert.equal(payloads[1].classroom_course_id, "gc9");
  assert.equal(payloads[1].slug, undefined);
});

test("P6 already imported same org+classroom id is success", async () => {
  const sb = mockSb({
    existing: { id: "c-existing", classroom_course_id: "gc1" },
  });
  const r = await importClassroomCourseToOrg(sb, {
    orgId: "org1",
    classroomCourse: { id: "gc1", name: "A" },
    userId: "u1",
  });
  assert.equal(r.ok, true);
  assert.equal(r.alreadyImported, true);
  assert.equal(r.courseId, "c-existing");
});

test("P6 missing classroom id fails before insert", async () => {
  const r = await importClassroomCourseToOrg({}, {
    orgId: "org1",
    classroomCourse: { name: "A" },
    userId: "u1",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "missing_classroom_id");
});
