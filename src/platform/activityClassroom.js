import { getSupabase } from "../supabaseClient.js";
import { getValidClassroomToken } from "./classroomToken.js";
import {
  createCourseWork,
  patchCourseWork,
  listStudentSubmissions,
  patchStudentSubmissionGrade,
  returnStudentSubmission,
} from "../classroom/classroomApi.js";

function activityDueParts(activity) {
  if (!activity?.due_at) return { dueDate: null, dueTime: null };
  const d = new Date(activity.due_at);
  if (Number.isNaN(d.getTime())) return { dueDate: null, dueTime: null };
  return {
    dueDate: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
    dueTime: { hours: d.getHours(), minutes: d.getMinutes() },
  };
}

function validateGradeForActivity(activity, grade) {
  if (grade == null) return null;
  const n = Number(grade);
  if (!Number.isFinite(n) || n < 0) return "Nota inválida.";
  if (activity?.max_points != null && n > Number(activity.max_points)) {
    return `La nota no puede superar el puntaje máximo (${activity.max_points}).`;
  }
  return null;
}

/**
 * Publica la actividad PyBot como courseWork en Classroom (sin duplicar).
 */
export async function publishActivityToClassroom({
  activity,
  classroomCourseId,
  userId,
}) {
  const sb = getSupabase();
  if (!sb || !activity?.id || !classroomCourseId) {
    return { ok: false, error: "missing_args" };
  }

  const tok = await getValidClassroomToken(userId);
  if (!tok) return { ok: false, error: "missing_access_token" };

  const activityUrl = `${window.location.origin}/actividad/${encodeURIComponent(activity.id)}`;
  const { dueDate, dueTime } = activityDueParts(activity);
  const payload = {
    title: activity.title || "Actividad PyBot",
    description: activity.description || "Abrí la actividad en PyBot para trabajar y entregar.",
    materials: [
      {
        link: {
          url: activityUrl,
          title: "Abrir en PyBot",
        },
      },
    ],
    dueDate,
    dueTime,
  };
  if (activity.max_points != null && Number.isFinite(Number(activity.max_points))) {
    payload.maxPoints = Number(activity.max_points);
  }

  try {
    let courseWorkId = activity.classroom_coursework_id;
    let courseWorkUrl = activity.classroom_coursework_url || null;
    let alreadyPublished = false;

    if (courseWorkId) {
      await patchCourseWork(tok, classroomCourseId, courseWorkId, payload);
      alreadyPublished = true;
    } else {
      const cw = await createCourseWork(tok, classroomCourseId, payload);
      courseWorkId = cw.id;
      courseWorkUrl =
        cw.alternateLink ||
        `https://classroom.google.com/c/${classroomCourseId}/a/${courseWorkId}`;
    }

    const { error } = await sb
      .from("activities")
      .update({
        classroom_coursework_id: courseWorkId,
        classroom_coursework_url: courseWorkUrl,
        classroom_last_synced_at: new Date().toISOString(),
      })
      .eq("id", activity.id);

    if (error) return { ok: false, error: error.message };
    return { ok: true, courseWorkId, url: courseWorkUrl, alreadyPublished };
  } catch (ex) {
    return { ok: false, error: ex?.message || "classroom_publish_failed", code: ex?.code };
  }
}

/**
 * Lee studentSubmissions de Classroom (no modifica PyBot submissions).
 */
export async function syncClassroomSubmissionsForActivity({
  classroomCourseId,
  courseWorkId,
  userId,
}) {
  const tok = await getValidClassroomToken(userId);
  if (!tok) return { ok: false, error: "missing_access_token", rows: [] };
  try {
    const rows = await listStudentSubmissions(tok, classroomCourseId, courseWorkId);
    return { ok: true, rows, error: null };
  } catch (ex) {
    return { ok: false, error: ex?.message || "sync_failed", rows: [], code: ex?.code };
  }
}

/**
 * Envía nota PyBot → Classroom (patch + return) y registra sync en DB.
 */
export async function sendGradeToClassroom({
  submission,
  activity,
  classroomCourseId,
  courseWorkId,
  classroomSubmissionId,
  userId,
}) {
  const sb = getSupabase();
  if (!sb || !submission?.id || submission.grade == null) {
    return { ok: false, error: "missing_grade" };
  }
  if (!classroomCourseId || !courseWorkId || !classroomSubmissionId) {
    return { ok: false, error: "missing_classroom_ids" };
  }

  const gradeErr = validateGradeForActivity(activity, submission.grade);
  if (gradeErr) return { ok: false, error: gradeErr };

  if (activity?.max_points == null) {
    return {
      ok: false,
      error: "Definí el puntaje máximo de la actividad antes de enviar notas a Classroom.",
    };
  }

  const tok = await getValidClassroomToken(userId);
  if (!tok) return { ok: false, error: "missing_access_token" };

  try {
    await patchStudentSubmissionGrade(
      tok,
      classroomCourseId,
      courseWorkId,
      classroomSubmissionId,
      submission.grade,
    );
    try {
      await returnStudentSubmission(tok, classroomCourseId, courseWorkId, classroomSubmissionId);
    } catch (retEx) {
      // return puede fallar si ya está returned; no abortar si la nota se asignó
      console.warn("returnStudentSubmission:", retEx);
    }

    const { error } = await sb
      .from("activity_submissions")
      .update({
        classroom_grade_synced_at: new Date().toISOString(),
        classroom_grade_sync_error: null,
        classroom_submission_id: classroomSubmissionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);

    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (ex) {
    const msg = ex?.message || "grade_sync_failed";
    await sb
      .from("activity_submissions")
      .update({
        classroom_grade_sync_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);
    return { ok: false, error: msg, code: ex?.code };
  }
}

/**
 * Relaciona submissions Classroom ↔ PyBot por userId Google / email.
 */
export function matchClassroomSubmission(
  classroomSub,
  pybotRow,
  profileByUserId,
  classroomUserIdByPybotUser,
  emailByPybotUser,
) {
  if (!classroomSub || !pybotRow) return false;
  const googleUid = classroomUserIdByPybotUser?.get(pybotRow.user_id);
  if (googleUid && classroomSub.userId === googleUid) return true;
  const email = emailByPybotUser?.get(pybotRow.user_id);
  if (email && classroomSub.profile?.emailAddress) {
    return email.trim().toLowerCase() === classroomSub.profile.emailAddress.trim().toLowerCase();
  }
  return false;
}
