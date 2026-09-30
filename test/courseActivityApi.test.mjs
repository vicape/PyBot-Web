import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_UPDATE_PERMISSION_HINT,
  STARTER_CODE_SCHEMA_HINT,
  listCourseAssignedContentActivities,
  updateCourseActivity,
} from "../src/platform/courseActivityApi.js";

test("listCourseAssignedContentActivities filters activities with content_snapshot", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            order: async () => ({
              data: [
                { id: "a1", content_snapshot: { schemaVersion: 3 }, course_id: "c1" },
                { id: "a2", content_snapshot: null, course_id: "c1" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  const { rows, error } = await listCourseAssignedContentActivities(supabase, "c1");
  assert.equal(error, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a1");
});

test("updateCourseActivity informa si falta la columna starter_code", async () => {
  const supabase = {
    rpc: async () => ({ error: { message: "column starter_code does not exist" } }),
    from: () => ({
      update: () => ({
        eq: async () => ({ error: { message: "column starter_code does not exist" } }),
      }),
    }),
  };

  const result = await updateCourseActivity(supabase, "act-1", {
    title: "Semaforo",
    starterCode: 'print("hola")',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, STARTER_CODE_SCHEMA_HINT);
});

test("updateCourseActivity informa si faltan permisos o RPC", async () => {
  const supabase = {
    rpc: async () => ({ error: { message: "Could not find the function update_activity_for_staff" } }),
    from: () => ({
      update: () => ({
        eq: async () => ({ error: { message: "new row violates row-level security policy" } }),
      }),
    }),
  };

  const result = await updateCourseActivity(supabase, "act-1", {
    title: "Semaforo",
    starterCode: 'print("hola")',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, ACTIVITY_UPDATE_PERMISSION_HINT);
});
