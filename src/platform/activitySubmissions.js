import { getSupabase } from "../supabaseClient.js";
import { turnInPybotActivityToClassroom } from "./activityClassroom.js";

const SUBMISSION_SELECT =
  "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version";

const SUBMISSION_TEACHER_SELECT =
  "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version, classroom_grade_synced_at, classroom_grade_sync_error, classroom_submission_id";

/** Etiqueta corta de versión formal (V1, V2…). */
export function submissionVersionLabel(version) {
  const n = Number(version);
  if (!Number.isFinite(n) || n < 1) return null;
  return `V${n}`;
}

/**
 * De una lista (posiblemente multi-versión), conserva la más reciente por user_id.
 * Preferir version; fallback a submitted_at.
 */
export function pickLatestSubmissionPerUser(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.user_id) continue;
    const prev = map.get(row.user_id);
    if (!prev) {
      map.set(row.user_id, row);
      continue;
    }
    const pv = Number(prev.version) || 0;
    const nv = Number(row.version) || 0;
    if (nv > pv) {
      map.set(row.user_id, row);
      continue;
    }
    if (nv === pv) {
      const pt = prev.submitted_at ? Date.parse(prev.submitted_at) : 0;
      const nt = row.submitted_at ? Date.parse(row.submitted_at) : 0;
      if (nt > pt) map.set(row.user_id, row);
    }
  }
  return [...map.values()];
}

/**
 * Entrega formal del alumno (RPC submit_activity).
 * Si la actividad está vinculada a Classroom, intenta turnIn best-effort
 * (no revierte la entrega PyBot si Google falla).
 */
export async function submitActivity(activityId, code) {
  const sb = getSupabase();
  if (!sb || !activityId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("submit_activity", {
    p_activity_id: activityId,
    p_code: code ?? "",
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "submit_failed" };

  let classroom = { ok: true, skipped: true };
  try {
    classroom = await turnInPybotActivityToClassroom(activityId);
  } catch (ex) {
    classroom = { ok: false, skipped: false, error: ex?.message || "classroom_turn_in_failed" };
  }

  return { ok: true, submission: data, classroom, error: null };
}

/** Lectura de la entrega formal actual (versión más reciente) del alumno. */
export async function fetchMySubmission(activityId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { submission: null, error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submissions")
    .select(SUBMISSION_SELECT)
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { submission: null, error: error.message };
  return { submission: data, error: null };
}

/**
 * Historial de entregas formales del alumno (V3 → V1).
 * Autorizado por RLS (propia o docente del curso).
 */
export async function fetchSubmissionHistory(activityId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { rows: [], error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submissions")
    .select(SUBMISSION_SELECT)
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .order("version", { ascending: false });

  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

/**
 * Lista entregas actuales de una actividad (docente): una fila por alumno
 * (versión más reciente). También expone `allRows` para historial mínimo.
 */
export async function fetchActivitySubmissions(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) return { rows: [], allRows: [], error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submissions")
    .select(SUBMISSION_TEACHER_SELECT)
    .eq("activity_id", activityId)
    .order("version", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (error) {
    // Fallback si aún no está la migración 029 / 045
    const fb = await sb
      .from("activity_submissions")
      .select(
        "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at",
      )
      .eq("activity_id", activityId)
      .order("submitted_at", { ascending: false });
    const allRows = fb.data ?? [];
    return {
      rows: pickLatestSubmissionPerUser(allRows),
      allRows,
      error: fb.error?.message ?? null,
    };
  }

  const allRows = data ?? [];
  return { rows: pickLatestSubmissionPerUser(allRows), allRows, error: null };
}

/** Corrección docente (actualiza exclusivamente la fila/id objetivo). */
export async function gradeSubmission(submissionId, grade, feedback) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("grade_activity_submission", {
    p_submission_id: submissionId,
    p_grade: grade == null || grade === "" ? null : Number(grade),
    p_feedback: feedback ?? null,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "grade_failed" };
  return { ok: true, result: data, error: null };
}

export function submissionStatusLabelEs(status) {
  switch (status) {
    case "draft":
      return "Borrador";
    case "submitted":
      return "Entregada";
    case "graded":
      return "Corregida";
    case "returned":
      return "Devuelta";
    default:
      return status || "—";
  }
}
