import { getSupabase } from "../supabaseClient.js";
import { getValidClassroomToken } from "./classroomToken.js";
import {
  createCourseWork,
  listStudentSubmissions,
  patchStudentSubmissionGrade,
  returnStudentSubmission,
} from "../classroom/classroomApi.js";

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
  if (activity.classroom_coursework_id) {
    return {
      ok: true,
      alreadyPublished: true,
      courseWorkId: activity.classroom_coursework_id,
      url: activity.classroom_coursework_url || null,
    };
  }

  const tok = await getValidClassroomToken(userId);
  if (!tok) return { ok: false, error: "missing_access_token" };

  const activityUrl = `${window.location.origin}/actividad/${encodeURIComponent(activity.id)}`;
  try {
    const cw = await createCourseWork(tok, classroomCourseId, {
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
    });

    const courseWorkId = cw.id;
    const courseWorkUrl =
      cw.alternateLink ||
      `https://classroom.google.com/c/${classroomCourseId}/a/${courseWorkId}`;

    const { error } = await sb
      .from("activities")
      .update({
        classroom_coursework_id: courseWorkId,
        classroom_coursework_url: courseWorkUrl,
      })
      .eq("id", activity.id);

    if (error) return { ok: false, error: error.message };
    return { ok: true, courseWorkId, url: courseWorkUrl, alreadyPublished: false };
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
export function matchClassroomSubmission(classroomSub, pybotRow, profileByUserId, classroomUserIdByPybotUser) {
  if (!classroomSub || !pybotRow) return false;
  const googleUid = classroomUserIdByPybotUser?.get(pybotRow.user_id);
  if (googleUid && classroomSub.userId === googleUid) return true;
  return false;
}
