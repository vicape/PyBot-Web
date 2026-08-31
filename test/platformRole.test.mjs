import { test } from "node:test";
import assert from "node:assert/strict";
import { isSuperAdmin } from "../src/platformRole.js";

test("isSuperAdmin solo con flag explícito en perfil", () => {
  assert.equal(isSuperAdmin({ is_super_admin: true }), true);
  assert.equal(isSuperAdmin({ is_super_admin: false }), false);
  assert.equal(isSuperAdmin({}), false);
  assert.equal(isSuperAdmin(null), false);
  assert.equal(isSuperAdmin({ preferred_role: "teacher" }), false);
});
