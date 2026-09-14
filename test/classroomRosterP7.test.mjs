import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConservativeActiveClassroomUserIds,
  summarizeClassroomSyncResults,
} from "../src/classroom/classroomRosterSync.js";

test("P7 conservative active ids union Classroom + existing", () => {
  assert.deepEqual(
    buildConservativeActiveClassroomUserIds(["a", "b"], ["b", "c"]).sort(),
    ["a", "b", "c"],
  );
  assert.deepEqual(buildConservativeActiveClassroomUserIds([], ["x"]), ["x"]);
  assert.deepEqual(buildConservativeActiveClassroomUserIds(["y"], []), ["y"]);
});

test("P7 report taxonomy mapped from legacy statuses", () => {
  const summary = summarizeClassroomSyncResults([
    { status: "importado" },
    { status: "actualizado" },
    { status: "actualizado" },
    { status: "no_registrado" },
    { status: "sin_email" },
  ]);
  assert.equal(summary.created, 1);
  assert.equal(summary.matched, 2);
  assert.equal(summary.pending, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.conflict, 0);
  assert.equal(summary.error, 0);
});
