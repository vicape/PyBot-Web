import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickLatestSubmissionPerUser,
  submissionVersionLabel,
} from "../src/platform/activitySubmissions.js";

const root = resolve(import.meta.dirname, "..");
const migration045 = readFileSync(
  resolve(root, "supabase/migrations/20260915000045_immutable_submission_versions.sql"),
  "utf8",
);
const activitySubmissionsSrc = readFileSync(
  resolve(root, "src/platform/activitySubmissions.js"),
  "utf8",
);

test("migración 045 agrega version y unique (activity_id, user_id, version)", () => {
  assert.match(migration045, /add column if not exists version integer/);
  assert.match(migration045, /set version = 1/);
  assert.match(migration045, /drop constraint if exists activity_submissions_activity_id_user_id_key/);
  assert.match(
    migration045,
    /add constraint activity_submissions_activity_user_version_key\s+unique \(activity_id, user_id, version\)/,
  );
  assert.match(migration045, /activity_submissions_latest_idx/);
});

test("migración 045: submit_activity INSERTA sin ON CONFLICT destructivo", () => {
  assert.match(migration045, /create or replace function public\.submit_activity/);
  assert.match(migration045, /'version', v_row\.version/);
  assert.doesNotMatch(migration045, /on conflict \(activity_id, user_id\) do update/);
  // El INSERT de submit_activity no debe reescribir código de una versión previa
  const submitFn = migration045.slice(
    migration045.indexOf("create or replace function public.submit_activity"),
    migration045.indexOf("grant execute on function public.submit_activity"),
  );
  assert.match(submitFn, /insert into public\.activity_submissions/);
  assert.doesNotMatch(submitFn, /on conflict/i);
});

test("migración 045: trigger de numeración con advisory lock + unique", () => {
  assert.match(migration045, /activity_submissions_assign_version/);
  assert.match(migration045, /pg_advisory_xact_lock/);
  assert.match(migration045, /coalesce\(max\(s\.version\), 0\) \+ 1/);
  assert.match(migration045, /activity_submissions_activity_user_version_key/);
});

test("migración 045: código e identidad de versión son inmutables", () => {
  assert.match(migration045, /activity_submissions_protect_immutable/);
  assert.match(migration045, /submitted_code is distinct from OLD\.submitted_code/);
  assert.match(migration045, /NEW\.version is distinct from OLD\.version/);
  assert.match(migration045, /immutable fields cannot be changed/);
});

test("migración 045: overview/gradebook/counts usan la versión más reciente", () => {
  assert.match(migration045, /order by sub\.version desc\s+limit 1/);
  assert.match(migration045, /submission_version int/);
  assert.match(migration045, /select distinct on \(s\.activity_id, s\.user_id\)/);
  assert.match(migration045, /order by s\.user_id, s\.activity_id, s\.version desc/);
});

test("migración 045: Classroom escribe classroom_submission_id solo en latest", () => {
  assert.match(migration045, /order by s\.version desc\s+limit 1/);
  assert.match(migration045, /where s\.id = v_latest_id/);
});

test("frontend fetchMySubmission pide la versión más reciente", () => {
  assert.match(activitySubmissionsSrc, /order\("version", \{ ascending: false \}\)/);
  assert.match(activitySubmissionsSrc, /limit\(1\)/);
  assert.match(activitySubmissionsSrc, /pickLatestSubmissionPerUser/);
  assert.match(activitySubmissionsSrc, /fetchSubmissionHistory/);
});

test("submissionVersionLabel formatea Vn", () => {
  assert.equal(submissionVersionLabel(1), "V1");
  assert.equal(submissionVersionLabel(3), "V3");
  assert.equal(submissionVersionLabel(null), null);
  assert.equal(submissionVersionLabel(0), null);
});

test("pickLatestSubmissionPerUser elige la versión máxima por alumno", () => {
  const rows = [
    { id: "a1", user_id: "u1", version: 1, submitted_at: "2026-01-01T00:00:00Z", submitted_code: "v1" },
    { id: "a2", user_id: "u1", version: 2, submitted_at: "2026-01-02T00:00:00Z", submitted_code: "v2" },
    { id: "a3", user_id: "u1", version: 3, submitted_at: "2026-01-03T00:00:00Z", submitted_code: "v3" },
    { id: "b1", user_id: "u2", version: 1, submitted_at: "2026-01-01T00:00:00Z", submitted_code: "other" },
  ];
  const latest = pickLatestSubmissionPerUser(rows);
  assert.equal(latest.length, 2);
  const u1 = latest.find((r) => r.user_id === "u1");
  const u2 = latest.find((r) => r.user_id === "u2");
  assert.equal(u1.id, "a3");
  assert.equal(u1.submitted_code, "v3");
  assert.equal(u2.id, "b1");
});

test("pickLatestSubmissionPerUser: versiones independientes por alumno", () => {
  const rows = [
    { id: "1", user_id: "alice", version: 2, submitted_code: "a2" },
    { id: "2", user_id: "bob", version: 5, submitted_code: "b5" },
  ];
  const latest = pickLatestSubmissionPerUser(rows);
  assert.deepEqual(
    latest.map((r) => r.submitted_code).sort(),
    ["a2", "b5"],
  );
});

test("ActivityPage muestra etiqueta de versión formal", () => {
  const src = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  assert.match(src, /submissionVersionLabel/);
  assert.match(src, /teacherHistoryByUser/);
  assert.match(src, /Historial/);
});

test("package.json permanece en 0.3.1", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.1");
});
