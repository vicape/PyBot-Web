import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPybotClassroomTurnIn,
  summarizeClassroomGradeBatch,
  summarizeClassroomReturnBatch,
} from "../src/platform/classroomSyncResults.js";
import { classifyClassroomConnectionError, CLASSROOM_CONNECTION } from "../src/platform/classifyClassroomConnection.js";
import { classroomTurnInSuccessMessage, classroomTurnInUserMessage } from "../src/platform/activityClassroom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("P11 PyBot saved even when Classroom fails/pending", () => {
  assert.deepEqual(classifyPybotClassroomTurnIn({ ok: false, needsConnect: true }).pybot, "saved");
  assert.equal(classifyPybotClassroomTurnIn({ ok: false, needsConnect: true }).classroom, "pending_auth");
  assert.equal(classifyPybotClassroomTurnIn({ ok: false, error: "x" }).classroom, "error");
  assert.equal(classifyPybotClassroomTurnIn({ ok: true }).classroom, "ok");
  assert.match(classroomTurnInUserMessage({ ok: false, needsConnect: true }) || "", /entregada en PyBot/);
  assert.match(classroomTurnInSuccessMessage({ ok: true }) || "", /PyBot/);
});

test("P12 grade batch summary success/skipped/error", () => {
  const s = summarizeClassroomGradeBatch([
    { ok: true },
    { ok: false, skipped: true },
    { ok: false, error: "x" },
    { ok: true },
  ]);
  assert.deepEqual(s, { success: 2, skipped: 1, error: 1, total: 4 });
});

test("P13 return batch uses same summary shape", () => {
  const s = summarizeClassroomReturnBatch([{ ok: true }, { ok: false }]);
  assert.equal(s.success, 1);
  assert.equal(s.error, 1);
});

test("P14 classifier: rate limit / network / associatedWithDeveloper", () => {
  assert.equal(classifyClassroomConnectionError({ status: 429 }).kind, "rate_limit");
  assert.equal(classifyClassroomConnectionError({ status: 429 }).status, CLASSROOM_CONNECTION.ERROR);
  assert.equal(classifyClassroomConnectionError({ message: "Failed to fetch" }).kind, "network");
  assert.equal(
    classifyClassroomConnectionError({ code: "coursework_not_associated_with_developer" }).kind,
    "associated_with_developer",
  );
  // temporary error must NOT be reconnect
  assert.equal(classifyClassroomConnectionError({ message: "boom" }).status, CLASSROOM_CONNECTION.ERROR);
});

test("P15 disconnect clears tokens only (source contract)", () => {
  const disc = readFileSync(join(root, "src/platform/disconnectClassroom.js"), "utf8");
  assert.match(disc, /clearClassroomTokens/);
  assert.match(disc, /clearClassroomTokenCache/);
  assert.doesNotMatch(disc, /signOut|signInWithOAuth/);
  const profile = readFileSync(join(root, "src/platform/profileApi.js"), "utf8");
  assert.match(profile, /export async function clearClassroomTokens/);
});

test("P16 migration review marker present; no VITE secret", () => {
  const mig = readFileSync(
    join(root, "supabase/migrations/20260914000047_classroom_tokens_server_only_review.sql"),
    "utf8",
  );
  assert.match(mig, /READY FOR MIGRATION REVIEW/);
  const tok = readFileSync(join(root, "src/platform/classroomToken.js"), "utf8");
  assert.doesNotMatch(tok, /VITE_GOOGLE_CLIENT_SECRET/);
  assert.match(tok, /\/api\/refresh-classroom-token/);
});

test("P17 OAuth production remains external checklist (no Google Cloud edits in repo)", () => {
  // Code responsibility: dedicated classroom callback + public client id only.
  const oauth = readFileSync(join(root, "src/platform/googleOAuth.js"), "utf8");
  assert.match(oauth, /VITE_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(oauth, /VITE_GOOGLE_CLIENT_SECRET/);
  assert.match(oauth, /auth\/classroom\/callback/);
});
