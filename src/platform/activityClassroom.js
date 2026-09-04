import { getSupabase } from "../supabaseClient.js";
import { getValidClassroomToken } from "./classroomToken.js";
import {
  createCourseWork,
  patchCourseWork,
  listStudentSubmissions,
  patchStudentSubmissionGrade,
  returnStudentSubmission,
  turnInStudentSubmission,
} from "../classroom/classroomApi.js";

async function tryGetClassroomToken(userId) {
  try {
    return await getValidClassroomToken(userId);
  } catch (ex) {
    return null;
  }
}
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

/** Mapea fila DB → forma compatible con la API de Classroom (userId / id). */
export function normalizeCachedClassroomSubmission(row) {
  if (!row) return null;
  return {
    id: row.classroom_submission_id,
    userId: row.classroom_user_id,
    courseWorkId: row.classroom_coursework_id,
    state: row.classroom_submission_state ?? undefined,
    late: Boolean(row.classroom_late),
    draftGrade: row.classroom_draft_grade ?? undefined,
    assignedGrade: row.classroom_assigned_grade ?? undefined,
    creationTime: row.classroom_submission_created_at ?? undefined,
    updateTime: row.classroom_submission_updated_at ?? undefined,
    // extras útiles para UI / lookup
    user_id: row.user_id ?? null,
    classroom_last_synced_at: row.classroom_last_synced_at ?? null,
  };
}

/**
 * Lee el cache persistente de StudentSubmissions (sin llamar a Google).
 */
export async function fetchCachedClassroomSubmissions(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) return { ok: false, error: "missing_args", rows: [], syncedAt: null };

  const { data, error } = await sb
    .from("activity_classroom_submissions")
    .select(
      "id, activity_id, user_id, classroom_user_id, classroom_submission_id, classroom_coursework_id, classroom_submission_state, classroom_late, classroom_draft_grade, classroom_assigned_grade, classroom_submission_created_at, classroom_submission_updated_at, classroom_last_synced_at, updated_at",
    )
    .eq("activity_id", activityId)
    .order("classroom_user_id", { ascending: true });

  if (error) return { ok: false, error: error.message, rows: [], syncedAt: null };

  const dbRows = data ?? [];
  let syncedAt = null;
  for (const r of dbRows) {
    const t = r.classroom_last_synced_at;
    if (t && (!syncedAt || t > syncedAt)) syncedAt = t;
  }

  return {
    ok: true,
    rows: dbRows.map(normalizeCachedClassroomSubmission).filter(Boolean),
    dbRows,
    syncedAt,
    error: null,
  };
}

/**
 * Lee studentSubmissions de Classroom y las persiste en Supabase.
 * No crea activity_submissions PyBot.
 */
export async function syncClassroomSubmissionsForActivity({
  activityId,
  classroomCourseId,
  courseWorkId,
  userId,
}) {
  const sb = getSupabase();
  const tok = await getValidClassroomToken(userId);
  if (!tok) return { ok: false, error: "missing_access_token", rows: [], persisted: 0, syncedAt: null };

  let googleRows;
  try {
    googleRows = await listStudentSubmissions(tok, classroomCourseId, courseWorkId);
  } catch (ex) {
    return {
      ok: false,
      error: ex?.message || "sync_failed",
      rows: [],
      persisted: 0,
      syncedAt: null,
      code: ex?.code,
    };
  }

  if (!activityId || !sb) {
    return {
      ok: false,
      error: "missing_activity_id",
      rows: googleRows ?? [],
      persisted: 0,
      syncedAt: null,
    };
  }

  const { data: out, error } = await sb.rpc("sync_activity_classroom_submissions", {
    p_activity_id: activityId,
    p_rows: googleRows ?? [],
  });

  if (error) {
    return {
      ok: false,
      error: error.message || "No se pudieron guardar las entregas sincronizadas.",
      rows: [],
      persisted: 0,
      syncedAt: null,
    };
  }
  if (!out?.ok) {
    return {
      ok: false,
      error: out?.error || "No se pudieron guardar las entregas sincronizadas.",
      rows: [],
      persisted: 0,
      syncedAt: null,
    };
  }

  const cached = await fetchCachedClassroomSubmissions(activityId);
  if (!cached.ok) {
    // Persistió OK pero no pudimos re-leer: devolver forma Google normalizada
    return {
      ok: true,
      rows: (googleRows ?? []).map((r) => ({
        id: r.id,
        userId: r.userId,
        courseWorkId: r.courseWorkId || courseWorkId,
        state: r.state,
        late: Boolean(r.late),
        draftGrade: r.draftGrade,
        assignedGrade: r.assignedGrade,
        creationTime: r.creationTime,
        updateTime: r.updateTime,
      })),
      persisted: out.persisted ?? (googleRows?.length ?? 0),
      syncedAt: out.syncedAt ?? new Date().toISOString(),
      error: null,
    };
  }

  return {
    ok: true,
    rows: cached.rows,
    persisted: out.persisted ?? cached.rows.length,
    syncedAt: out.syncedAt || cached.syncedAt,
    error: null,
  };
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

/**
 * Tras entregar en PyBot: turnIn de la StudentSubmission del alumno en Classroom.
 * No bloquea la entrega PyBot — best effort.
 * Requiere que el alumno haya conectado Classroom (scope coursework.me)
 * y que el courseWork lo haya creado este mismo proyecto OAuth.
 */
export async function turnInPybotActivityToClassroom(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) return { ok: false, skipped: true, error: "missing_args" };

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return { ok: false, skipped: true, error: "no_session" };

  const { data: act, error: actErr } = await sb
    .from("activities")
    .select("id, course_id, classroom_coursework_id")
    .eq("id", activityId)
    .maybeSingle();

  if (actErr || !act) return { ok: false, skipped: true, error: actErr?.message || "activity_not_found" };
  if (!act.classroom_coursework_id) {
    return { ok: true, skipped: true, error: null };
  }

  const { data: course } = await sb
    .from("courses")
    .select("classroom_course_id")
    .eq("id", act.course_id)
    .maybeSingle();

  const classroomCourseId = course?.classroom_course_id;
  if (!classroomCourseId) {
    return { ok: true, skipped: true, error: null };
  }

  const tok = await tryGetClassroomToken(user.id);
  if (!tok) {
    return {
      ok: false,
      skipped: false,
      needsConnect: true,
      error: "missing_access_token",
    };
  }

  let classroomSubmissionId = null;

  // 1) cache persistente (fila del alumno)
  const cached = await fetchCachedClassroomSubmissions(activityId);
  const mine = (cached.rows || []).find((r) => r.user_id === user.id);
  if (mine?.id) classroomSubmissionId = mine.id;

  // 2) activity_submissions.classroom_submission_id
  if (!classroomSubmissionId) {
    const { data: sub } = await sb
      .from("activity_submissions")
      .select("classroom_submission_id")
      .eq("activity_id", activityId)
      .eq("user_id", user.id)
      .maybeSingle();
    classroomSubmissionId = sub?.classroom_submission_id || null;
  }

  // 3) Google: mi StudentSubmission (userId=me)
  if (!classroomSubmissionId) {
    try {
      const mineRows = await listStudentSubmissions(
        tok,
        classroomCourseId,
        act.classroom_coursework_id,
        "me",
      );
      classroomSubmissionId = mineRows?.[0]?.id || null;
    } catch (ex) {
      return {
        ok: false,
        skipped: false,
        needsConnect: /insufficient|scope|permission|401|403/i.test(String(ex?.message || "")),
        error: ex?.message || "list_submissions_failed",
        code: ex?.code,
      };
    }
  }

  if (!classroomSubmissionId) {
    return {
      ok: false,
      skipped: false,
      error: "classroom_submission_not_found",
    };
  }

  try {
    await turnInStudentSubmission(
      tok,
      classroomCourseId,
      act.classroom_coursework_id,
      classroomSubmissionId,
    );
  } catch (ex) {
    const msg = String(ex?.message || "");
    // Ya entregada en Classroom → éxito idempotente
    if (/already.?turned.?in|FAILED_PRECONDITION|ALREADY_EXISTS/i.test(msg) || ex?.status === 409) {
      return { ok: true, skipped: false, alreadyTurnedIn: true, classroomSubmissionId, error: null };
    }
    return {
      ok: false,
      skipped: false,
      needsConnect: /insufficient|scope|permission|401|403/i.test(msg),
      error: msg || "turn_in_failed",
      code: ex?.code,
    };
  }

  // Best-effort: guardar id en entrega PyBot (puede fallar por RLS; no crítico)
  await sb
    .from("activity_submissions")
    .update({
      classroom_submission_id: classroomSubmissionId,
      updated_at: new Date().toISOString(),
    })
    .eq("activity_id", activityId)
    .eq("user_id", user.id);

  // Best-effort: estado TURNED_IN en cache (solo si hay política que lo permita)
  await sb
    .from("activity_classroom_submissions")
    .update({
      classroom_submission_state: "TURNED_IN",
      classroom_submission_id: classroomSubmissionId,
      updated_at: new Date().toISOString(),
    })
    .eq("activity_id", activityId)
    .eq("user_id", user.id);

  return { ok: true, skipped: false, classroomSubmissionId, error: null };
}
