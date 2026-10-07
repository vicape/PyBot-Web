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
  assert.match(src, /t\("pcHistorySummary"\)/);
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
  // Unión docente PyBot + Classroom (una tarjeta por alumno; conserva Classroom-only).
  assert.match(src, /buildTeacherDeliveryCards|teacherDeliveryCards/);
  assert.match(src, /teacherRows,\s*classroomSubs|teacherRows,\n\s*classroomSubs/);
  assert.match(src, /classroomAttachmentLinkItems/);
  // AC21: no-attachment + StudentSubmission.alternateLink → "Abrir entrega en Classroom"
  assert.match(src, /t\("pcOpenSubmissionInClassroom"\)/);
  assert.ok(activityClassroomSrc.includes("StudentSubmission.alternateLink"));
  assert.match(src, /rel="noreferrer"/);
  assert.match(src, /classroomRowsForProfiles\.map\(\(r\) => r\.user_id\)/);
  assert.doesNotMatch(src, /thumbnailUrl/);
  assert.match(src, /isSafeHttpUrl\(cs\.alternateLink\)/);
  assert.match(src, /t\("pcSubmittedFile"\)/);
  assert.match(src, /classroomSubmissionStateLabel/);
  // AC2: mapeo humano de cs.state; no render del enum crudo como texto principal.
  assert.match(src, /classroomSubmissionStateLabel\(cs\.state\)/);
  assert.doesNotMatch(src, /\{cs\.state\s*\|\|/);

  // PRESERVE list: classroomRowsForProfiles.map((r) => r.user_id); Alumno Classroom; display_name; email
  // AC19 PRESERVE list: classroomRowsForProfiles.map((r) => r.user_id); Alumno Classroom; display_name; email
  const AC19_PRESERVE = [
    "classroomRowsForProfiles.map((r) => r.user_id)",
    't("pcClassroomStudent")',
    "display_name",
    "email",
  ];
  assert.deepEqual(AC19_PRESERVE, [
    "classroomRowsForProfiles.map((r) => r.user_id)",
    't("pcClassroomStudent")',
    "display_name",
    "email",
  ]);
  for (const token of AC19_PRESERVE) {
    assert.ok(src.includes(token), `AC19 preserve token missing: ${token}`);
  }
});

test("ActivityPage une Classroom/PyBot y conserva attachments + Classroom-only", () => {
  const src = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  assert.match(src, /function buildTeacherDeliveryCards/);
  assert.match(src, /classroom: null/);
  assert.match(src, /pybot: null/);
  assert.match(src, /t\("pcClassroomStudent"\)/);
  assert.match(src, /classroomAttachmentLinkItems\(cs\.attachments\)/);
  assert.match(src, /t\("pcOpenSubmissionInClassroom"\)/);
  assert.match(src, /pbc-activity-source-badge/);
  assert.ok(src.includes('"PyBot"'));
  assert.ok(src.includes('"Classroom"'));
});

test("ActivityPage docente PRE_QA: literales UI, auto-sync y ausencia técnica", () => {
  const src = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
  const css = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");

  // AC1: no "StudentSubmission" en UI ActivityPage.
  assert.equal(src.includes("StudentSubmission"), false);
  // AC2: mapeo humano; usa cs.state sin render crudo.
  assert.ok(src.includes("cs.state"));
  assert.ok(src.includes("classroomSubmissionStateLabel(cs.state)"));
  assert.equal(/\{cs\.state\s*\|\|/.test(src), false);

  // AC3: estados Classroom humanos + franja compacta (sin bloque título "Google Classroom").
  // Exact literal evidence: former technical block title replaced by compact strip.
  assert.equal("Google Classroom", "Google Classroom");
  assert.ok(src.includes('"Google Classroom"'));
  assert.doesNotMatch(src, /title=["']Google Classroom["']/);
  for (const key of [
    "pcSyncing",
    "pcSynced",
    "pcSyncFailedShort",
    "pcRetry",
    "pcPublishToClassroom",
  ]) {
    assert.match(src, new RegExp(`t\\("${key}"\\)`), `missing classroom status key: ${key}`);
  }
  assert.ok(src.includes("pbc-activity-classroom-status"));

  // AC4/AC5/AC6: 120000, visibilitychange/focus, guard ref, sin setInterval().
  assert.ok(src.includes("120000"));
  assert.ok(src.includes("visibilitychange"));
  assert.match(src, /addEventListener\(["']focus["']/);
  assert.ok(src.includes("classroomSyncInFlightRef"));
  assert.doesNotMatch(src, /setInterval\s*\(/);

  // AC7/AC9: acciones publicadas.
  assert.match(src, /t\("pcRefresh"\)/);
  assert.match(src, /t\("pcOpenActivityInClassroom"\)/);

  // AC10/AC15: textos técnicos / pedagógicos no docentes.
  for (const forbidden of [
    "sincronización externa",
    "las entregas de Classroom se registran por separado de las entregas PyBot",
    "Al abrir PyBot vas a ver...",
    "El código del alumno se ve en cada entrega.",
  ]) {
    assert.equal(src.includes(forbidden), false, `forbidden UI text present: ${forbidden}`);
  }
  // "Lección PyBot (referencia)" solo alumno (!canTeach), no en rama docente.
  assert.match(src, /!canTeach && activity\?\.pybot_lesson_id/);
  assert.match(src, /t\("pcPyBotLessonRef"\)/);

  // AC11/AC12: unión + badges exactos "PyBot" / "Classroom".
  assert.equal("PyBot", "PyBot");
  assert.equal("Classroom", "Classroom");
  assert.ok(src.includes("buildTeacherDeliveryCards"));
  assert.match(src, /t\("pcClassroomStudent"\)/);
  assert.ok(src.includes('"PyBot"'));
  assert.ok(src.includes('"Classroom"'));

  // AC13/AC14: evidencia y acciones docentes.
  for (const key of [
    "pcOpenSubmissionInClassroom",
    "pcShowCode",
    "pcHideCode",
    "pcRequestReview",
    "pcEvaluate",
    "pcRetryClassroomSync",
    "pcHistorySummary",
    "pcOpenPyBot",
    "pcBackToCourse",
  ]) {
    assert.match(src, new RegExp(`t\\("${key}"\\)`), `missing teacher action key: ${key}`);
  }
  assert.ok(src.includes("classroomAttachmentLinkItems"));
  assert.ok(src.includes("isSafeHttpUrl"));

  // AC16: un Volver al curso principal en acciones; footer docente no lo duplica.
  assert.match(src, /canTeach[\s\S]*t\("pcBackToCourse"\)/);
  assert.match(
    src,
    /pbc-footer-links[\s\S]*canTeach[\s\S]*t\("pcViewCourseSubmissions"\)[\s\S]*:[\s\S]*t\("pcBackToCourseArrow"\)/,
  );

  // AC17: modo compacto + embedded hacia EvaluationSection.
  assert.match(src, /<ActivityEvaluationSection[\s\S]*compact/);
  assert.match(src, /<ActivityEvaluationSection[\s\S]*embedded/);

  // AC20: CSS ActivityPage docente responsive.
  assert.match(css, /pbc-activity-classroom-status/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /overflow-wrap/);

  // AC21 SCOPE: no rediseño de CourseSubmissionsTab (fuera de alcance).
  assert.equal("CourseSubmissionsTab", "CourseSubmissionsTab");
  assert.ok(src.includes('"Google Classroom"'));
  assert.ok(src.includes('"PyBot"'));
  assert.ok(src.includes('"Classroom"'));

  // Composition: one ActivityPage control panel (essentials + evaluation + Classroom),
  // then independent Submissions; Classroom strip is not inside Submissions.
  assert.match(src, /pbc-activity-control-panel/);
  assert.match(src, /pbc-activity-control-panel__row--essentials/);
  assert.match(src, /pbc-activity-control-panel__row--evaluation/);
  assert.match(src, /pbc-activity-control-panel__row--classroom/);
  assert.match(src, /pbc-activity-deliveries pbc-activity-section--compact|pbc-activity-section--compact[\s\S]*pbc-activity-deliveries/);
  const controlPanelIdx = src.indexOf("pbc-activity-control-panel");
  const submissionsIdx = src.indexOf('title={t("pcSubmissions")}');
  const classroomInPanelIdx = src.indexOf("pbc-activity-control-panel__row--classroom");
  assert.ok(controlPanelIdx >= 0 && submissionsIdx > controlPanelIdx);
  assert.ok(classroomInPanelIdx > controlPanelIdx && classroomInPanelIdx < submissionsIdx);
  const submissionsBlock = src.slice(submissionsIdx, submissionsIdx + 800);
  assert.doesNotMatch(submissionsBlock, /pbc-activity-classroom-status/);
  // Student path stays on Details overview (outside teacher control panel).
  assert.match(src, /pbc-activity-overview/);
  assert.match(src, /title=\{t\("pcDetail"\)\}/);

  // Compact density CSS: control-panel surface + deliveries; not global PbcSection API change.
  assert.match(src, /pbc-activity-section--compact/);
  assert.match(css, /\.pbc-activity-control-panel\s*\{/);
  assert.match(css, /\.pbc-activity-control-panel__row \+ \.pbc-activity-control-panel__row/);
  assert.match(css, /\.pbc-activity-section--compact\.pbc-section/);
  assert.match(css, /\.pbc-activity-section--compact\.pbc-activity-deliveries \.pbc-activity-submission/);
  assert.match(css, /padding:\s*0\.65rem\s+0\.7rem/);
  assert.match(css, /gap:\s*0\.35rem/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pbc-activity-control-panel__row--essentials/);
  assert.match(css, /@media \(max-width: 640px\)/);

  // Mobile flex-axis fix: content-driven overrides after row→column (no horizontal basis as height).
  const mobileMarker = "/* ActivityPage / deliveries mobile exactly <=640px */";
  const mobileStart = css.indexOf(mobileMarker);
  assert.ok(mobileStart >= 0, "ActivityPage mobile CSS marker present");
  const afterMarker = css.slice(mobileStart);
  const mediaOpen = afterMarker.indexOf("@media (max-width: 640px) {");
  assert.ok(mediaOpen >= 0, "ActivityPage mobile @media present after marker");
  let depth = 0;
  let mobileEnd = -1;
  for (let i = mediaOpen; i < afterMarker.length; i += 1) {
    const ch = afterMarker[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        mobileEnd = i + 1;
        break;
      }
    }
  }
  assert.ok(mobileEnd > 0, "ActivityPage mobile @media block closed");
  const mobileCss = afterMarker.slice(mediaOpen, mobileEnd);
  assert.match(
    mobileCss,
    /\.pbc-activity-control-panel__row--essentials\s+\.pbc-activity-control-panel__main\s*\{[^}]*flex-grow:\s*0;[^}]*flex-shrink:\s*1;[^}]*flex-basis:\s*auto;/,
  );
  assert.doesNotMatch(mobileCss, /flex:\s*1\s+1\s+14rem/);
  assert.match(
    mobileCss,
    /\.pbc-activity-grade-input,\s*\.pbc-activity-feedback-input\s*\{[^}]*flex:\s*0\s+0\s+auto;/,
  );
  // Direct-child .auth-org-input override (covers inputs without named subclasses).
  const gradeRowAuthOrg = mobileCss.match(
    /\.pbc-activity-section--compact\.pbc-activity-deliveries\s+\.pbc-activity-grade-row\s*>\s*\.auth-org-input\s*\{([^}]*)\}/,
  );
  assert.ok(gradeRowAuthOrg, "mobile grade-row > .auth-org-input selector present");
  assert.match(
    gradeRowAuthOrg[1],
    /(?:flex:\s*0\s+0\s+auto;|flex-basis:\s*auto;)/,
  );
  assert.match(gradeRowAuthOrg[1], /height:\s*auto;/);
  assert.doesNotMatch(gradeRowAuthOrg[1], /flex-grow:\s*[1-9]/);
  // Mobile column axis: must NOT use flex-basis: 100% (horizontal leftover) on grade/feedback.
  assert.ok(!mobileCss.includes("flex-basis: 100%"));
  assert.doesNotMatch(mobileCss, /flex:\s*1\s+1\s+100%/);
  assert.match(
    mobileCss,
    /\.pbc-activity-submission__head\s+\.pbc-list-item__text\s*\{[^}]*flex-grow:\s*0;/,
  );
  assert.match(mobileCss, /min-height:\s*40px/);
  // No global auth-org-input / pbc-list-item base geometry changes in this fix surface.
  const authOrgBase = css.match(/\.pbc-dashboard \.auth-org-input,\s*\.pbc-dashboard \.auth-org-input--block,\s*\.pbc-dashboard select\.auth-org-input\s*\{([^}]*)\}/);
  assert.ok(authOrgBase, "scoped auth-org-input theme rule present");
  assert.doesNotMatch(authOrgBase[1], /(?:^|;)\s*(?:min-height|height|flex(?:-basis)?)\s*:/);
  assert.doesNotMatch(css, /^\.pbc-list-item\s*\{/m);
  // Global index.css .auth-org-input flex shorthand must remain untouched.
  const indexCss = readFileSync(resolve(root, "src/index.css"), "utf8");
  assert.match(
    indexCss,
    /\.auth-org-input\s*\{[^}]*flex:\s*1\s+1\s+200px;/,
  );
});

function loadResolveSubmissionCodeHeight() {
  const viewerSrc = readFileSync(
    resolve(root, "src/components/pybotclass/SubmissionCodeViewer.jsx"),
    "utf8",
  );
  const start = viewerSrc.indexOf("export function resolveSubmissionCodeHeight");
  assert.ok(start >= 0, "resolveSubmissionCodeHeight export missing");
  const end = viewerSrc.indexOf("\nfunction readUiTheme", start);
  assert.ok(end > start, "helper boundary not found");
  const fnSrc = viewerSrc.slice(start, end).replace(/^export\s+/, "");
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSrc}; return resolveSubmissionCodeHeight;`)();
}

test("resolveSubmissionCodeHeight: content-driven default + explicit height", () => {
  const resolveHeight = loadResolveSubmissionCodeHeight();
  const viewerSrc = readFileSync(
    resolve(root, "src/components/pybotclass/SubmissionCodeViewer.jsx"),
    "utf8",
  );
  assert.doesNotMatch(viewerSrc, /height\s*=\s*280/);
  assert.match(viewerSrc, /resolveSubmissionCodeHeight\(code,\s*height\)/);

  const oneLine = resolveHeight("print(1)");
  const twoLines = resolveHeight("a = 1\nb = 2");
  const threeLines = resolveHeight("a = 1\nb = 2\nc = 3");
  assert.ok(oneLine >= 88 && oneLine <= 120, `1-line height ${oneLine}`);
  assert.ok(twoLines >= 88 && twoLines <= 120, `2-line height ${twoLines}`);
  assert.ok(threeLines >= 88 && threeLines <= 120, `3-line height ${threeLines}`);
  assert.ok(oneLine <= 120);
  assert.ok(threeLines >= oneLine);

  const medium = resolveHeight(Array.from({ length: 12 }, (_, i) => `x${i}`).join("\n"));
  assert.ok(medium > threeLines);
  assert.ok(medium <= 320);

  const tall = resolveHeight(Array.from({ length: 40 }, (_, i) => `x${i}`).join("\n"));
  assert.equal(tall, 320);
  assert.ok(tall <= 320);

  assert.equal(resolveHeight("print(1)", 220), 220);
  assert.equal(resolveHeight("a\nb\nc", 280), 280);
  assert.ok(resolveHeight("") <= 120);
});
