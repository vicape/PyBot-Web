import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("P7 UI no promete borrado automático de alumnos", () => {
  const page = readFileSync(
    new URL("../src/pages/CourseActivitiesPage.jsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /quitará del curso a los alumnos importados/);
  assert.doesNotMatch(page, /quita del curso a quienes ya no están en Classroom/);
  assert.match(page, /No elimina automáticamente alumnos/);
  const roster = readFileSync(
    new URL("../src/components/pybotclass/CourseRosterTab.jsx", import.meta.url),
    "utf8",
  );
  assert.match(roster, /matched/);
  assert.match(roster, /No se eliminan alumnos/);
});
