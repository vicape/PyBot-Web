import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityClassroomCapabilities,
  canModifyClassroomCourseWork,
  isClassroomImportedActivity,
  normalizeActivityOrigin,
} from "../src/platform/activityOrigin.js";
import {
  classroomDuePartsToIso,
  pybotDueAtToClassroomParts,
  roundTripClassroomDueAt,
} from "../src/platform/classroomDueDate.js";
import { mapClassroomCourseWorkToActivity } from "../src/platform/pybotClassApi.js";

test("P8 origin normalize", () => {
  assert.equal(normalizeActivityOrigin("pybot"), "pybot");
  assert.equal(normalizeActivityOrigin("classroom"), "classroom");
  assert.equal(normalizeActivityOrigin("other"), null);
  assert.equal(normalizeActivityOrigin(null), null);
});

test("P8 imported detection never treats unknown as pybot", () => {
  assert.equal(isClassroomImportedActivity({ origin: "classroom" }), true);
  assert.equal(isClassroomImportedActivity({ origin: "pybot" }), false);
  assert.equal(
    isClassroomImportedActivity({ origin: null, classroom_coursework_id: "cw1" }),
    true,
  );
  assert.equal(activityClassroomCapabilities({ origin: "pybot" }).treatAsPybotCreated, true);
  assert.equal(activityClassroomCapabilities({ origin: "classroom" }).treatAsPybotCreated, false);
});

test("P8 associatedWithDeveloper gate", () => {
  assert.equal(canModifyClassroomCourseWork({ classroom_associated_with_developer: true }), true);
  assert.equal(canModifyClassroomCourseWork({ classroom_associated_with_developer: false }), false);
  assert.equal(canModifyClassroomCourseWork({}), false);
});

test("P10 UTC due conversion is host-timezone independent", () => {
  const iso = "2026-03-15T18:30:00.000Z";
  const parts = pybotDueAtToClassroomParts(iso);
  assert.deepEqual(parts.dueDate, { year: 2026, month: 3, day: 15 });
  assert.deepEqual(parts.dueTime, { hours: 18, minutes: 30 });
  assert.equal(classroomDuePartsToIso(parts.dueDate, parts.dueTime), iso);
  assert.equal(roundTripClassroomDueAt(iso), iso);
});

test("P10 date-only Classroom due defaults to 23:59 UTC", () => {
  const iso = classroomDuePartsToIso({ year: 2026, month: 6, day: 1 }, null);
  assert.equal(iso, "2026-06-01T23:59:00.000Z");
});

test("P8/P10 mapClassroomCourseWorkToActivity keeps origin+UTC", () => {
  const mapped = mapClassroomCourseWorkToActivity({
    id: "cw1",
    title: "Tarea",
    dueDate: { year: 2026, month: 3, day: 15 },
    dueTime: { hours: 18, minutes: 30 },
    associatedWithDeveloper: false,
  });
  assert.equal(mapped.origin, "classroom");
  assert.equal(mapped.classroom_coursework_id, "cw1");
  assert.equal(mapped.due_at, "2026-03-15T18:30:00.000Z");
  assert.equal(mapped.classroom_associated_with_developer, false);
});
