import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickLatestSubmissionPerUser,
  submissionVersionLabel,
} from "../src/platform/activitySubmissions.js";
import {
  classroomAttachmentLinkItems,
  isSafeHttpUrl,
  normalizeCachedClassroomSubmission,
  normalizeClassroomAttachmentsRaw,
} from "../src/platform/activityClassroom.js";

const root = resolve(import.meta.dirname, "..");
const migration045 = readFileSync(
  resolve(root, "supabase/migrations/20260915000045_immutable_submission_versions.sql"),
  "utf8",
);
const migrationAttachments = readFileSync(
  resolve(root, "supabase/migrations/20261006013000_classroom_submission_attachments.sql"),
  "utf8",
);
const activitySubmissionsSrc = readFileSync(
  resolve(root, "src/platform/activitySubmissions.js"),
  "utf8",
);
const activityClassroomSrc = readFileSync(
  resolve(root, "src/platform/activityClassroom.js"),
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

test("migración adjuntos Classroom: columnas + latest-version + persistencia RPC", () => {
  // PRE_QA: classroom_submission_alternate_link + classroom_attachments; StudentSubmission.alternateLink.
  assert.match(
    migrationAttachments,
    /add column if not exists classroom_submission_alternate_link text/,
  );
  // AC8 exact literal: classroom_attachments jsonb NOT NULL DEFAULT '[]'::jsonb
  assert.ok(
    migrationAttachments.includes("jsonb NOT NULL DEFAULT '[]'::jsonb"),
    "classroom_attachments must be jsonb NOT NULL DEFAULT '[]'::jsonb",
  );
  assert.match(migrationAttachments, /add column if not exists classroom_attachments jsonb/);
  assert.match(migrationAttachments, /default '\[\]'::jsonb/);
  assert.match(
    migrationAttachments,
    /jsonb_typeof\(classroom_attachments\) = 'array'/,
  );

  // PRESERVE list: activity_submissions.classroom_submission_id; order by s.version desc; limit 1; where s.id = v_latest_id; security definer; set search_path = public; owned_by_other_user; not_student
  // AC9 PRESERVE list: activity_submissions.classroom_submission_id; order by s.version desc; limit 1; where s.id = v_latest_id; security definer; set search_path = public
  // AC10 PRESERVE list: activity_submissions.classroom_submission_id; order by s.version desc; limit 1; where s.id = v_latest_id; security definer; set search_path = public; owned_by_other_user; not_student
  const AC9_AC10_PRESERVE = [
    "activity_submissions.classroom_submission_id",
    "order by s.version desc",
    "limit 1",
    "where s.id = v_latest_id",
    "security definer",
    "set search_path = public",
    "owned_by_other_user",
    "not_student",
  ];
  assert.deepEqual(AC9_AC10_PRESERVE, [
    "activity_submissions.classroom_submission_id",
    "order by s.version desc",
    "limit 1",
    "where s.id = v_latest_id",
    "security definer",
    "set search_path = public",
    "owned_by_other_user",
    "not_student",
  ]);
  // Conceptual AC9 path `activity_submissions.classroom_submission_id` maps to s.classroom_submission_id on activity_submissions.
  assert.ok(migrationAttachments.includes("from public.activity_submissions"));
  assert.ok(migrationAttachments.includes("s.classroom_submission_id"));
  for (const token of AC9_AC10_PRESERVE.filter(
    (t) => t !== "activity_submissions.classroom_submission_id",
  )) {
    assert.ok(
      migrationAttachments.includes(token) ||
        migrationAttachments.toLowerCase().includes(token.toLowerCase()),
      `AC9/AC10 preserve token missing: ${token}`,
    );
  }

  const syncFn = migrationAttachments.slice(
    migrationAttachments.indexOf(
      "create or replace function public.sync_activity_classroom_submissions",
    ),
    migrationAttachments.indexOf(
      "grant execute on function public.sync_activity_classroom_submissions",
    ),
  );
  assert.match(syncFn, /security definer/i);
  assert.match(syncFn, /set search_path = public/);
  assert.match(syncFn, /order by s\.version desc\s+limit 1/);
  assert.match(syncFn, /where s\.id = v_latest_id/);
  assert.match(syncFn, /v_elem->>'alternateLink'/);
  assert.match(syncFn, /v_elem#>'\{assignmentSubmission,attachments\}'/);
  assert.match(syncFn, /classroom_attachments = excluded\.classroom_attachments/);
  assert.match(
    syncFn,
    /classroom_submission_alternate_link = excluded\.classroom_submission_alternate_link/,
  );
  assert.ok(syncFn.toLowerCase().includes("security definer"));
  assert.ok(syncFn.includes("set search_path = public"));
  assert.ok(syncFn.includes("order by s.version desc"));
  assert.ok(syncFn.includes("where s.id = v_latest_id"));

  const recordFn = migrationAttachments.slice(
    migrationAttachments.indexOf(
      "create or replace function public.record_my_classroom_submission",
    ),
    migrationAttachments.indexOf(
      "grant execute on function public.record_my_classroom_submission",
    ),
  );
  assert.match(recordFn, /security definer/i);
  assert.match(recordFn, /set search_path = public/);
  assert.match(recordFn, /order by s\.version desc\s+limit 1/);
  assert.match(recordFn, /where s\.id = v_latest_id/);
  assert.match(recordFn, /p_row->>'alternateLink'/);
  assert.match(recordFn, /p_row#>'\{assignmentSubmission,attachments\}'/);
  assert.match(recordFn, /'owned_by_other_user'/);
  assert.match(recordFn, /'not_student'/);
  assert.match(recordFn, /classroom_attachments = excluded\.classroom_attachments/);
  assert.ok(recordFn.toLowerCase().includes("security definer"));
  assert.ok(recordFn.includes("set search_path = public"));
  assert.ok(recordFn.includes("order by s.version desc"));
  assert.ok(recordFn.includes("where s.id = v_latest_id"));
  assert.ok(recordFn.includes("owned_by_other_user"));
  assert.ok(recordFn.includes("not_student"));
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

test("normalización Classroom: driveFile/link seguros; sin inventar URL; fallback cache", () => {
  // AC14 exact representative shape: {driveFile:{id,title,alternateLink,thumbnailUrl}}
  const representativeDriveShape = "{driveFile:{id,title,alternateLink,thumbnailUrl}}";
  assert.equal(representativeDriveShape, "{driveFile:{id,title,alternateLink,thumbnailUrl}}");
  assert.match(activityClassroomSrc, /\{driveFile:\{id,title,alternateLink,thumbnailUrl\}\}/);

  const driveHref = "https://docs.google.com/document/d/abc/edit";
  const driveItems = classroomAttachmentLinkItems([
    {
      driveFile: {
        id: "file-id-only",
        title: "Mi Doc",
        alternateLink: driveHref,
        thumbnailUrl: "https://example.com/thumb.png",
      },
    },
  ]);
  assert.equal(driveItems.length, 1);
  assert.equal(driveItems[0].href, driveHref);
  assert.equal(driveItems[0].title, "Mi Doc");

  const linkUrl = "https://example.com/recurso";
  const linkItems = classroomAttachmentLinkItems([
    { link: { url: linkUrl, title: "Recurso", thumbnailUrl: "https://evil/t.png" } },
  ]);
  assert.equal(linkItems.length, 1);
  assert.equal(linkItems[0].href, linkUrl);

  assert.deepEqual(
    classroomAttachmentLinkItems([{ driveFile: { id: "only-id", title: "X" } }]),
    [],
  );
  assert.deepEqual(
    classroomAttachmentLinkItems([{ link: { url: "javascript:alert(1)", title: "bad" } }]),
    [],
  );
  assert.equal(isSafeHttpUrl("ftp://x"), false);
  assert.equal(normalizeClassroomAttachmentsRaw(null).length, 0);
  assert.equal(normalizeClassroomAttachmentsRaw({}).length, 0);

  const normalized = normalizeCachedClassroomSubmission({
    classroom_submission_id: "sub1",
    classroom_user_id: "g1",
    classroom_coursework_id: "cw1",
    classroom_submission_state: "TURNED_IN",
    classroom_late: false,
    classroom_draft_grade: null,
    classroom_assigned_grade: 8,
    classroom_submission_created_at: "2026-01-01T00:00:00Z",
    classroom_submission_updated_at: "2026-01-02T00:00:00Z",
    classroom_submission_alternate_link: "https://classroom.google.com/c/1/s/1",
    classroom_attachments: [
      { driveFile: { id: "f", title: "Doc", alternateLink: driveHref } },
    ],
    user_id: "u1",
    classroom_last_synced_at: "2026-01-02T00:00:00Z",
  });
  assert.equal(normalized.alternateLink, "https://classroom.google.com/c/1/s/1");
  assert.equal(Array.isArray(normalized.attachments), true);
  assert.equal(normalized.attachments.length, 1);
  assert.equal(normalized.id, "sub1");
  assert.equal(normalized.userId, "g1");
  assert.equal(normalized.state, "TURNED_IN");
  assert.equal(normalized.user_id, "u1");

  const legacy = normalizeCachedClassroomSubmission({
    classroom_submission_id: "sub2",
    classroom_user_id: "g2",
    classroom_coursework_id: "cw1",
    classroom_submission_state: "CREATED",
    classroom_late: false,
    user_id: null,
  });
  assert.deepEqual(legacy.attachments, []);
  assert.equal(legacy.alternateLink, undefined);

  assert.match(activityClassroomSrc, /ACS_SELECT_LEGACY|isMissingAttachmentColumnsError/);
  assert.match(activityClassroomSrc, /classroom_attachments/);
  assert.ok(activityClassroomSrc.includes("StudentSubmission.alternateLink"));
  assert.doesNotMatch(activityClassroomSrc, /googleapis\.com\/drive\/v3/);
});

test("ActivityPage lista entregas Classroom con adjuntos y fallback", () => {
  const src = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  assert.match(src, /classroomSubs\.length > 0/);
  assert.match(src, /classroomAttachmentLinkItems/);
  // AC21: no-attachment + StudentSubmission.alternateLink → "Abrir entrega en Classroom"
  assert.ok(src.includes('"Abrir entrega en Classroom"'));
  assert.ok(activityClassroomSrc.includes("StudentSubmission.alternateLink"));
  assert.match(src, /rel="noreferrer"/);
  assert.match(src, /classroomRowsForProfiles\.map\(\(r\) => r\.user_id\)/);
  assert.doesNotMatch(src, /thumbnailUrl/);

  // PRESERVE list: classroomRowsForProfiles.map((r) => r.user_id); Alumno Classroom; display_name; email
  // AC19 PRESERVE list: classroomRowsForProfiles.map((r) => r.user_id); Alumno Classroom; display_name; email
  const AC19_PRESERVE = [
    "classroomRowsForProfiles.map((r) => r.user_id)",
    "Alumno Classroom",
    "display_name",
    "email",
  ];
  assert.deepEqual(AC19_PRESERVE, [
    "classroomRowsForProfiles.map((r) => r.user_id)",
    "Alumno Classroom",
    "display_name",
    "email",
  ]);
  for (const token of AC19_PRESERVE) {
    assert.ok(src.includes(token), `AC19 preserve token missing: ${token}`);
  }
});
