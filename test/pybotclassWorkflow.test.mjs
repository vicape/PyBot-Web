import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  canStudentSubmit,
  deriveInboxFilterId,
  deriveProcessStatus,
  deriveSubmissionWindow,
  deriveTimeliness,
  processStatusLabelEs,
  rubricMatchesActivityMax,
  studentNextActionMessage,
  sumRubricPoints,
  timelinessLabelEs,
} from "../src/platform/submissionWorkflow.js";
import {
  pickLatestSubmissionPerUser,
  submissionStatusLabelEs,
  submissionVersionLabel,
} from "../src/platform/activitySubmissions.js";
import { classroomGradeSyncUserMessage } from "../src/platform/activityClassroom.js";
import { CLASSROOM_TEACHER_FEEDBACK_SYNC_SUPPORTED } from "../src/classroom/classroomApi.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mig046 = readFileSync(
  resolve(root, "supabase/migrations/20260915200046_pybotclass_workflow_rubrics.sql"),
  "utf8",
);
const mig045 = readFileSync(
  resolve(root, "supabase/migrations/20260915000045_immutable_submission_versions.sql"),
  "utf8",
);
const activityPage = readFileSync(resolve(root, "src/pages/ActivityPage.jsx"), "utf8");
const submissionsTab = readFileSync(
  resolve(root, "src/components/pybotclass/CourseSubmissionsTab.jsx"),
  "utf8",
);
const activitiesTab = readFileSync(
  resolve(root, "src/components/pybotclass/CourseActivitiesTab.jsx"),
  "utf8",
);
const appSrc = readFileSync(resolve(root, "src/App.jsx"), "utf8");

// A–G versions + review cycle labels
test("A/B: V1 inmutable — migración 045 INSERT + protect_immutable", () => {
  assert.match(mig045, /activity_submissions_protect_immutable/);
  assert.match(mig045, /insert into public\.activity_submissions/);
  assert.doesNotMatch(mig045, /on conflict \(activity_id, user_id\) do update/i);
});

test("C/D: solicitar revisión → returned + feedback sin nota obligatoria", () => {
  assert.match(mig046, /request_activity_review/);
  assert.match(mig046, /status = 'returned'/);
  assert.match(activityPage, /Solicitar revisión/);
  assert.match(activityPage, /onRequestReview/);
  assert.equal(
    processStatusLabelEs(deriveProcessStatus({ status: "returned", hasSubmission: true })),
    "Revisión solicitada",
  );
  assert.match(studentNextActionMessage("revision_solicitada"), /solicitó cambios/i);
});

test("E/F/G: reentrega V2+ = Reentregado; V1 intacta por unique version", () => {
  assert.equal(
    processStatusLabelEs(
      deriveProcessStatus({ status: "submitted", version: 2, hasSubmission: true }),
    ),
    "Reentregado",
  );
  assert.match(mig045, /unique \(activity_id, user_id, version\)/);
  const latest = pickLatestSubmissionPerUser([
    { user_id: "u1", version: 1, submitted_code: "v1", submitted_at: "2026-01-01" },
    { user_id: "u1", version: 2, submitted_code: "v2", submitted_at: "2026-01-02" },
  ]);
  assert.equal(latest[0].version, 2);
  assert.equal(latest[0].submitted_code, "v2");
});

test("H: ActivityPage historial + ver código de versiones", () => {
  assert.match(activityPage, /Historial/);
  assert.match(activityPage, /teacherHistoryByUser/);
  assert.match(activityPage, /SubmissionCodeViewer/);
});

test("I/J/K/L/M: Evaluar guarda nota/feedback/rúbrica; total = suma", () => {
  assert.match(mig046, /grade_activity_submission/);
  assert.match(mig046, /activity_submission_rubric_scores/);
  assert.match(mig046, /v_final_grade := v_total/);
  assert.match(activityPage, />Evaluar</);
  assert.equal(sumRubricPoints([{ points: 3 }, { points: 4 }]), 7);
  assert.ok(rubricMatchesActivityMax([{ max_points: 4 }, { max_points: 6 }], 10));
  assert.ok(!rubricMatchesActivityMax([{ max_points: 4 }, { max_points: 6 }], 9));
});

test("N/O: Cerrar bloquea reentrega salvo reopen", () => {
  assert.match(mig046, /close_activity_submission/);
  assert.match(mig046, /status = 'closed'/);
  assert.equal(
    canStudentSubmit({
      processStatus: "cerrado",
      windowStatus: "abierta",
      reopenActive: false,
    }),
    false,
  );
  assert.equal(
    canStudentSubmit({
      processStatus: "cerrado",
      windowStatus: "cerrada",
      reopenActive: true,
    }),
    true,
  );
});

test("P/Q/R: reopen individual + submit_activity consume reopen; otro alumno no", () => {
  assert.match(mig046, /reopen_activity_submission/);
  assert.match(mig046, /activity_submission_reopens/);
  assert.match(mig046, /activity_submission_window_open/);
  assert.match(activityPage, /Reabrir para este alumno/);
  // ventana cerrada sin reopen → bloqueado
  assert.equal(
    canStudentSubmit({
      processStatus: "en_progreso",
      windowStatus: "cerrada",
      reopenActive: false,
    }),
    false,
  );
});

test("S/T/U: a tiempo / tarde / bloqueada por close", () => {
  assert.equal(
    deriveTimeliness({
      submittedAt: "2026-09-15T19:00:00Z",
      dueAt: "2026-09-15T20:00:00Z",
    }),
    "a_tiempo",
  );
  assert.equal(
    deriveTimeliness({
      submittedAt: "2026-09-15T21:00:00Z",
      dueAt: "2026-09-15T20:00:00Z",
    }),
    "tarde",
  );
  assert.equal(timelinessLabelEs("tarde"), "Tarde");
  assert.equal(
    deriveSubmissionWindow({
      closeAt: "2026-09-15T23:59:00Z",
      now: Date.parse("2026-09-16T00:00:00Z"),
    }),
    "cerrada",
  );
  assert.equal(
    deriveSubmissionWindow({
      closeAt: "2026-09-15T23:59:00Z",
      now: Date.parse("2026-09-15T22:00:00Z"),
    }),
    "abierta",
  );
  // Sin close: abierta (tarde permitida)
  assert.equal(deriveSubmissionWindow({ closeAt: null }), "abierta");
  assert.match(mig046, /submission_close_at/);
  assert.match(mig046, /submissions_closed/);
  assert.match(activitiesTab, /act-close/);
  assert.match(activitiesTab, /Cierre de entregas/);
});

test("V/W/X: Classroom note auto + retry; feedback never synced", () => {
  assert.match(activityPage, /sendGradeToClassroom/);
  assert.match(activityPage, /Evaluación guardada en PyBotClass/);
  assert.match(activityPage, /Reintentar sync Classroom/);
  assert.equal(CLASSROOM_TEACHER_FEEDBACK_SYNC_SUPPORTED, false);
  const msg = classroomGradeSyncUserMessage({ hasFeedback: true });
  assert.match(msg, /Nota sincronizada/);
  assert.match(msg, /feedback permanece/i);
  assert.doesNotMatch(msg, /feedback sincronizado/i);
});

test("Y: RPCs docentes security definer + teacher check (alumno forbidden)", () => {
  assert.match(mig046, /request_activity_review/);
  assert.match(mig046, /is_course_teacher/);
  assert.match(mig046, /forbidden/);
  assert.match(mig046, /invalid_transition/);
});

test("Z: UX clásica inaccesible; una sola UX moderna", () => {
  assert.match(appSrc, /ClassicCourseRedirect/);
  assert.doesNotMatch(activityPage, /Vista clásica/i);
  assert.match(activityPage, /PyBotClassShell/);
});

test("Bandeja: filtros proceso completos + puntualidad separada", () => {
  assert.match(submissionsTab, /INBOX_FILTERS/);
  assert.match(submissionsTab, /revision_solicitada/);
  assert.match(submissionsTab, /reentregadas/);
  assert.match(submissionsTab, /evaluadas/);
  assert.match(submissionsTab, /cerradas/);
  assert.match(submissionsTab, /Puntualidad/);
  assert.equal(
    deriveInboxFilterId({
      submission_id: "s",
      submission_status: "submitted",
      submission_version: 2,
    }),
    "reentregadas",
  );
  assert.equal(
    deriveInboxFilterId({
      submission_id: "s",
      submission_status: "returned",
      submission_version: 1,
    }),
    "revision_solicitada",
  );
});

test("Labels proceso coherentes alumno/docente", () => {
  assert.equal(submissionStatusLabelEs("submitted", { version: 1 }), "Entregado");
  assert.equal(submissionStatusLabelEs("submitted", { version: 3 }), "Reentregado");
  assert.equal(submissionStatusLabelEs("graded"), "Evaluado");
  assert.equal(submissionStatusLabelEs("closed"), "Cerrado");
  assert.equal(submissionVersionLabel(1), "V1");
});

test("046 overview expone due/close/late/reopen", () => {
  assert.match(mig046, /activity_due_at/);
  assert.match(mig046, /activity_close_at/);
  assert.match(mig046, /is_late/);
  assert.match(mig046, /reopen_active/);
});

test("Transiciones: entregado no puede auto-evaluarse vía canStudentSubmit", () => {
  assert.equal(
    canStudentSubmit({
      processStatus: "entregado",
      windowStatus: "abierta",
    }),
    false,
  );
  assert.equal(
    canStudentSubmit({
      processStatus: "revision_solicitada",
      windowStatus: "abierta",
    }),
    true,
  );
});
