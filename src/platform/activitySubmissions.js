import { getSupabase } from "../supabaseClient.js";
import { turnInPybotActivityToClassroom } from "./activityClassroom.js";
import {
  deriveProcessStatus,
  processStatusLabelEs,
  studentNextActionMessage,
} from "./submissionWorkflow.js";

const SUBMISSION_SELECT =
  "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version, returned_at, closed_at";

const SUBMISSION_TEACHER_SELECT =
  "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version, returned_at, closed_at, closed_by, classroom_grade_synced_at, classroom_grade_sync_error, classroom_submission_id";

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

  // Point 4 bridge: submitted/quiz_finished items complete with activity submission.
  try {
    const { data: act } = await sb
      .from("activities")
      .select("content_snapshot")
      .eq("id", activityId)
      .maybeSingle();
    if (act?.content_snapshot) {
      const { bridgeSubmissionToItemProgress } = await import("./activityItemProgress.js");
      await bridgeSubmissionToItemProgress(activityId, act.content_snapshot, {
        status: "submitted",
        version: data?.version ?? 1,
      });
    }
  } catch {
    /* non-fatal: submission already succeeded */
  }

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

  if (error) {
    // Fallback sin columnas 046
    const fb = await sb
      .from("activity_submissions")
      .select(
        "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version",
      )
      .eq("activity_id", activityId)
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { submission: fb.data, error: fb.error?.message ?? null };
  }
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
    const fb = await sb
      .from("activity_submissions")
      .select(
        "id, activity_id, user_id, submitted_code, status, submitted_at, grade, feedback, graded_at, updated_at, version, classroom_grade_synced_at, classroom_grade_sync_error, classroom_submission_id",
      )
      .eq("activity_id", activityId)
      .order("version", { ascending: false })
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

/** Evaluar (nota + feedback + rúbrica opcional). */
export async function gradeSubmission(submissionId, grade, feedback, rubricScores = null) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("grade_activity_submission", {
    p_submission_id: submissionId,
    p_grade: grade == null || grade === "" ? null : Number(grade),
    p_feedback: feedback ?? null,
    p_rubric_scores: rubricScores,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "grade_failed", detail: data };
  return { ok: true, result: data, error: null };
}

/** Solicitar revisión (returned). No exige nota. */
export async function requestSubmissionReview(submissionId, feedback = null) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("request_activity_review", {
    p_submission_id: submissionId,
    p_feedback: feedback ?? null,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "review_failed" };
  return { ok: true, result: data, error: null };
}

/** Cerrar corrección (graded → closed). */
export async function closeSubmission(submissionId) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("close_activity_submission", {
    p_submission_id: submissionId,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "close_failed" };
  return { ok: true, result: data, error: null };
}

/** Reabrir individualmente para un alumno. */
export async function reopenSubmissionForStudent(activityId, userId, note = null) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("reopen_activity_submission", {
    p_activity_id: activityId,
    p_user_id: userId,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "reopen_failed" };
  return { ok: true, result: data, error: null };
}

export async function fetchActiveReopen(activityId, userId) {
  const sb = getSupabase();
  if (!sb || !activityId || !userId) return { reopen: null, error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submission_reopens")
    .select("activity_id, user_id, active, reopened_at, note")
    .eq("activity_id", activityId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) return { reopen: null, error: error.message };
  return { reopen: data, error: null };
}

export async function fetchActivityRubric(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) {
    return { rubric: null, criteria: [], error: "missing_args" };
  }

  const { data: rubric, error } = await sb
    .from("activity_rubrics")
    .select(
      "id, activity_id, scoring_mode, schema_generation, source_template_id, frozen_at, updated_at",
    )
    .eq("activity_id", activityId)
    .maybeSingle();

  if (error) return { rubric: null, criteria: [], error: error.message };
  if (!rubric) return { rubric: null, criteria: [], error: null };

  const { data: criteria, error: cErr } = await sb
    .from("activity_rubric_criteria")
    .select("id, rubric_id, name, description, max_points, sort_order")
    .eq("rubric_id", rubric.id)
    .order("sort_order", { ascending: true });

  if (cErr) return { rubric, criteria: [], error: cErr.message };

  const critRows = criteria ?? [];
  const critIds = critRows.map((c) => c.id).filter(Boolean);
  let levelsByCriterion = new Map();
  if (critIds.length) {
    const { data: levels, error: lErr } = await sb
      .from("activity_rubric_levels")
      .select("id, criterion_id, name, descriptor, sort_order, points")
      .in("criterion_id", critIds)
      .order("sort_order", { ascending: true });
    if (lErr) return { rubric, criteria: critRows, error: lErr.message };
    levelsByCriterion = new Map();
    for (const lv of levels ?? []) {
      const arr = levelsByCriterion.get(lv.criterion_id) || [];
      arr.push(lv);
      levelsByCriterion.set(lv.criterion_id, arr);
    }
  }

  const withLevels = critRows.map((c) => ({
    ...c,
    levels: levelsByCriterion.get(c.id) || [],
  }));

  return { rubric, criteria: withLevels, error: null };
}

export async function upsertActivityRubric(activityId, criteria, scoringMode = "points") {
  const sb = getSupabase();
  if (!sb || !activityId) return { ok: false, error: "missing_args" };

  const payload = (criteria || []).map((c) => {
    const levels = c.levels || c.achievement_levels;
    if (Array.isArray(levels) && levels.length > 0) {
      return {
        name: c.name,
        description: c.description ?? null,
        sort_order: c.sort_order ?? c.sortOrder ?? undefined,
        levels: levels.map((lv, i) => ({
          name: lv.name,
          descriptor: lv.descriptor ?? lv.description ?? null,
          sort_order: lv.sort_order ?? lv.sortOrder ?? i,
          points: lv.points ?? null,
        })),
      };
    }
    return {
      name: c.name,
      description: c.description ?? null,
      max_points: Number(c.max_points ?? c.maxPoints),
    };
  });

  const { data, error } = await sb.rpc("upsert_activity_rubric", {
    p_activity_id: activityId,
    p_criteria: payload,
    p_scoring_mode: scoringMode,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "rubric_failed", detail: data };
  return { ok: true, result: data, error: null };
}

export async function clearActivityRubric(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) return { ok: false, error: "missing_args" };

  const { data, error } = await sb.rpc("clear_activity_rubric", {
    p_activity_id: activityId,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "clear_failed" };
  return { ok: true, error: null };
}

export async function listMyRubricTemplates() {
  const sb = getSupabase();
  if (!sb) return { templates: [], error: "missing_args" };
  const { data, error } = await sb.rpc("list_my_rubric_templates");
  if (error) return { templates: [], error: error.message };
  if (!data?.ok) return { templates: [], error: data?.error || "list_failed" };
  return { templates: data.templates ?? [], error: null };
}

export async function getRubricTemplate(templateId) {
  const sb = getSupabase();
  if (!sb || !templateId) return { template: null, error: "missing_args" };
  const { data, error } = await sb.rpc("get_rubric_template", {
    p_template_id: templateId,
  });
  if (error) return { template: null, error: error.message };
  if (!data?.ok) return { template: null, error: data?.error || "get_failed" };
  return { template: data.template, error: null };
}

export async function upsertRubricTemplate({
  templateId = null,
  name,
  description = null,
  scoringMode,
  criteria,
} = {}) {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "missing_args" };
  const { data, error } = await sb.rpc("upsert_rubric_template", {
    p_template_id: templateId,
    p_name: name,
    p_description: description,
    p_scoring_mode: scoringMode,
    p_criteria: criteria,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "template_failed", detail: data };
  return { ok: true, result: data, error: null };
}

export async function deleteRubricTemplate(templateId) {
  const sb = getSupabase();
  if (!sb || !templateId) return { ok: false, error: "missing_args" };
  const { data, error } = await sb.rpc("delete_rubric_template", {
    p_template_id: templateId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "delete_failed" };
  return { ok: true, error: null };
}

export async function applyRubricTemplateToActivity(activityId, templateId) {
  const sb = getSupabase();
  if (!sb || !activityId || !templateId) return { ok: false, error: "missing_args" };
  const { data, error } = await sb.rpc("apply_rubric_template_to_activity", {
    p_activity_id: activityId,
    p_template_id: templateId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "apply_failed", detail: data };
  return { ok: true, result: data, error: null };
}

export async function saveSubmissionRubricDraft(submissionId, rubricScores) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { ok: false, error: "missing_args" };
  const { data, error } = await sb.rpc("save_activity_rubric_draft", {
    p_submission_id: submissionId,
    p_rubric_scores: rubricScores,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "draft_failed", detail: data };
  return { ok: true, result: data, error: null };
}

export async function fetchSubmissionRubricDraft(submissionId) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { drafts: [], error: "missing_args" };
  const { data, error } = await sb
    .from("activity_submission_rubric_drafts")
    .select("id, submission_id, criterion_id, level_id, points, comment, updated_at")
    .eq("submission_id", submissionId);
  if (error) return { drafts: [], error: error.message };
  return { drafts: data ?? [], error: null };
}

export async function fetchSubmissionRubricScores(submissionId) {
  const sb = getSupabase();
  if (!sb || !submissionId) return { scores: [], error: "missing_args" };

  const { data, error } = await sb
    .from("activity_submission_rubric_scores")
    .select(
      "id, submission_id, criterion_id, points, comment, level_id, level_name, level_descriptor",
    )
    .eq("submission_id", submissionId);

  if (error) return { scores: [], error: error.message };
  return { scores: data ?? [], error: null };
}

/** Label DB legacy + proceso visible. */
export function submissionStatusLabelEs(status, { version } = {}) {
  const process = deriveProcessStatus({
    status,
    version,
    hasSubmission: Boolean(status),
  });
  if (
    status === "draft" ||
    status === "submitted" ||
    status === "returned" ||
    status === "graded" ||
    status === "closed"
  ) {
    return processStatusLabelEs(process);
  }
  return status || "—";
}

export { deriveProcessStatus, processStatusLabelEs, studentNextActionMessage };
