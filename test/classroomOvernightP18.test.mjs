/**
 * P18 — suite de consolidación overnight Classroom/PyBotClass.
 * Importa smoke tests clave sin hardware.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCourseRole } from "../src/platform/courseRole.js";
import { resolveImportOrgId } from "../src/platform/classroomOrgContext.js";
import { isClassroomIdInsertError } from "../src/platform/importClassroomCourse.js";
import { buildConservativeActiveClassroomUserIds } from "../src/classroom/classroomRosterSync.js";
import { normalizeActivityOrigin } from "../src/platform/activityOrigin.js";
import { pybotDueAtToClassroomParts } from "../src/platform/classroomDueDate.js";
import { classifyPybotClassroomTurnIn } from "../src/platform/classroomSyncResults.js";
import { CLASSROOM_CONNECTION, classifyClassroomConnectionError } from "../src/platform/classifyClassroomConnection.js";

test("P18 overnight consolidation smoke", () => {
  assert.equal(normalizeCourseRole("owner"), "teacher");
  assert.equal(resolveImportOrgId({ selectedOrgId: "b", staffOrgs: [{ id: "a" }, { id: "b" }] }), "b");
  assert.equal(isClassroomIdInsertError({ message: "classroom_course_id missing" }), true);
  assert.deepEqual(buildConservativeActiveClassroomUserIds(["a"], ["b"]).sort(), ["a", "b"]);
  assert.equal(normalizeActivityOrigin("classroom"), "classroom");
  assert.equal(pybotDueAtToClassroomParts("2026-01-02T03:04:00.000Z").dueTime.hours, 3);
  assert.equal(classifyPybotClassroomTurnIn({ ok: false, error: "x" }).pybot, "saved");
  assert.equal(classifyClassroomConnectionError({ code: "invalid_grant" }).status, CLASSROOM_CONNECTION.RECONNECT_REQUIRED);
});
