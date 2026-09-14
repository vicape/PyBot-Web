import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classroomOrgAccountNotice,
  isStaffOrgId,
  pickInitialClassroomOrgId,
  resolveImportOrgId,
  saveClassroomOrgHint,
  loadClassroomOrgHint,
  clearClassroomOrgHint,
} from "../src/platform/classroomOrgContext.js";

test("P5 resolveImportOrgId: never invents org from staffOrgs[0]", () => {
  const staff = [{ id: "org-a" }, { id: "org-b" }];
  assert.equal(resolveImportOrgId({ selectedOrgId: "", staffOrgs: staff }), "");
  assert.equal(resolveImportOrgId({ selectedOrgId: "org-b", staffOrgs: staff }), "org-b");
  assert.equal(resolveImportOrgId({ selectedOrgId: "org-x", staffOrgs: staff }), "");
});

test("P5 pickInitial: multi-org without hint/prefer → empty (force choose)", () => {
  const staff = [{ id: "org-a" }, { id: "org-b" }];
  assert.equal(pickInitialClassroomOrgId({ staffOrgs: staff }), "");
  assert.equal(
    pickInitialClassroomOrgId({ preferredOrgId: "org-b", staffOrgs: staff }),
    "org-b",
  );
  assert.equal(
    pickInitialClassroomOrgId({ lastHintOrgId: "org-a", staffOrgs: staff }),
    "org-a",
  );
});

test("P5 pickInitial: single staff org auto-selects", () => {
  assert.equal(pickInitialClassroomOrgId({ staffOrgs: [{ id: "only" }] }), "only");
});

test("P5 preferred wins over silent first org", () => {
  const staff = [{ id: "org-a" }, { id: "org-b" }];
  // preferred org-b must win even if first is org-a
  assert.equal(
    pickInitialClassroomOrgId({
      preferredOrgId: "org-b",
      lastHintOrgId: "org-a",
      staffOrgs: staff,
    }),
    "org-b",
  );
});

test("P5 isStaffOrgId", () => {
  assert.equal(isStaffOrgId("a", [{ id: "a" }]), true);
  assert.equal(isStaffOrgId("b", [{ id: "a" }]), false);
});

test("P5 org hint storage", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  saveClassroomOrgHint("org-1", storage);
  assert.equal(loadClassroomOrgHint(storage), "org-1");
  clearClassroomOrgHint(storage);
  assert.equal(loadClassroomOrgHint(storage), null);
});

test("P5 account notice mismatch vs global", () => {
  const mismatch = classroomOrgAccountNotice({
    selectedOrgId: "org-b",
    hintOrgId: "org-a",
  });
  assert.equal(mismatch.kind, "mismatch");
  const global = classroomOrgAccountNotice({
    selectedOrgId: "org-a",
    hintOrgId: "org-a",
  });
  assert.equal(global.kind, "global");
});
