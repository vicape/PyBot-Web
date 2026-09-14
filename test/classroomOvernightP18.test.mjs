/**
 * P18 — suite de consolidación overnight Classroom/PyBotClass (post-corrections).
 * Importa smoke tests clave sin hardware / sin migraciones aplicadas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourseRole } from "../src/platform/courseRole.js";
import { resolveImportOrgId } from "../src/platform/classroomOrgContext.js";
import { isClassroomIdInsertError } from "../src/platform/importClassroomCourse.js";
import { buildConservativeActiveClassroomUserIds } from "../src/classroom/classroomRosterSync.js";
import { normalizeActivityOrigin } from "../src/platform/activityOrigin.js";
import { pybotDueAtToClassroomParts } from "../src/platform/classroomDueDate.js";
import {
  classifyPybotClassroomTurnIn,
  formatClassroomBatchSummary,
  summarizeClassroomGradeBatch,
  summarizeClassroomReturnBatch,
} from "../src/platform/classroomSyncResults.js";
import {
  CLASSROOM_CONNECTION,
  classifyClassroomConnectionError,
} from "../src/platform/classifyClassroomConnection.js";
import {
  classroomP17Status,
  isClassroomExternalSetupComplete,
} from "../src/platform/classroomExternalChecklist.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("P18 overnight consolidation smoke (post-corrections)", () => {
  assert.equal(normalizeCourseRole("owner"), "teacher");
  assert.equal(
    resolveImportOrgId({ selectedOrgId: "b", staffOrgs: [{ id: "a" }, { id: "b" }] }),
    "b",
  );
  assert.equal(isClassroomIdInsertError({ message: "classroom_course_id missing" }), true);
  assert.deepEqual(buildConservativeActiveClassroomUserIds(["a"], ["b"]).sort(), ["a", "b"]);
  assert.equal(normalizeActivityOrigin("classroom"), "classroom");
  assert.equal(pybotDueAtToClassroomParts("2026-01-02T03:04:00.000Z").dueTime.hours, 3);
  assert.equal(classifyPybotClassroomTurnIn({ ok: false, error: "x" }).pybot, "saved");
  assert.equal(
    classifyClassroomConnectionError({ code: "invalid_grant" }).status,
    CLASSROOM_CONNECTION.RECONNECT_REQUIRED,
  );

  // P14/P12/P13
  const batch = summarizeClassroomGradeBatch([
    { ok: true, return_status: "ok" },
    { skipped: true },
    { ok: false, error: "x" },
    { ok: true, return_status: "skipped_not_turned_in" },
  ]);
  assert.equal(batch.success, 2);
  assert.equal(batch.skipped, 1);
  assert.equal(batch.error, 1);
  assert.equal(batch.returnSkipped, 1);
  assert.match(formatClassroomBatchSummary("t", batch), /omitidas/);
  const ret = summarizeClassroomReturnBatch([
    { returned: true, return_status: "ok" },
    { return_status: "skipped_not_turned_in" },
  ]);
  assert.equal(ret.success, 1);
  assert.equal(ret.skipped, 1);

  // P17 never complete from code alone
  assert.equal(isClassroomExternalSetupComplete(), false);
  assert.equal(classroomP17Status().complete, false);

  // P5/P16 vault + P7 migration bodies present (not applied)
  const mig45 = readFileSync(
    join(root, "supabase/migrations/20260914000045_organization_classroom_credentials.sql"),
    "utf8",
  );
  assert.match(mig45, /private\.classroom_oauth_secrets/);
  const mig46 = readFileSync(
    join(root, "supabase/migrations/20260914000046_classroom_roster_no_autodelete.sql"),
    "utf8",
  );
  assert.match(mig46, /auto_delete_disabled/);
  assert.doesNotMatch(mig46, /with doomed as/);

  const mig48 = readFileSync(
    join(root, "supabase/migrations/20260914000048_classroom_grade_return_status.sql"),
    "utf8",
  );
  assert.match(mig48, /classroom_grade_return_status/);
  assert.match(mig48, /error_retryable/);

  const tok = readFileSync(join(root, "src/platform/classroomToken.js"), "utf8");
  assert.doesNotMatch(tok, /getStoredGoogleRefreshToken/);
  assert.match(tok, /org_id/);

  const disc = readFileSync(join(root, "src/platform/disconnectClassroom.js"), "utf8");
  assert.match(disc, /\/api\/disconnect-classroom/);
  assert.match(disc, /org_scoped_disconnect_unavailable/);
});
