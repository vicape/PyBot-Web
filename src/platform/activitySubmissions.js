import { getSupabase } from "../supabaseClient.js";
import { turnInPybotActivityToClassroom } from "./activityClassroom.js";

/** Entrega formal del alumno (RPC submit_activity) + turnIn Classroom best-effort. */
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

/** Lectura de la entrega propia del alumno. */
export async function fetchMySubmission(activityId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { submission: null, error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submissions")
    .select(
      "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at",
    )
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { submission: null, error: error.message };
  return { submission: data, error: null };
}

/** Lista entregas de una actividad (docente). */
export async function fetchActivitySubmissions(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) return { rows: [], error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submissions")
    .select(
      "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, classroom_grade_synced_at, classroom_grade_sync_error, classroom_submission_id",
    )
    .eq("activity_id", activityId)
    .order("submitted_at", { ascending: false });

  if (error) {
    // Fallback si aún no está la migración 029
    const fb = await sb
      .from("activity_submissions")
      .select(
        "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at",
      )
      .eq("activity_id", activityId)
      .order("submitted_at", { ascending: false });
    return { rows: fb.data ?? [], error: fb.error?.message ?? null };
  }
  return { rows: data ?? [], error: null };
}

/** Corrección docente. */
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
