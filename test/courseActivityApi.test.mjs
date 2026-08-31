import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_UPDATE_PERMISSION_HINT,
  STARTER_CODE_SCHEMA_HINT,
  updateCourseActivity,
} from "../src/platform/courseActivityApi.js";

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
