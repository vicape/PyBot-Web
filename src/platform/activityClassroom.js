import { getSupabase } from "../supabaseClient.js";
import { getValidClassroomToken } from "./classroomToken.js";
import {
  createCourseWork,
  getCourseWork,
  patchCourseWork,
  listStudentSubmissions,
  patchStudentSubmissionGrade,
  returnStudentSubmission,
  turnInStudentSubmission,
} from "../classroom/classroomApi.js";

async function tryGetClassroomToken(userId, opts = {}) {
  try {
    return await getValidClassroomToken(userId, opts);
  } catch {
    return null;
  }
}

function isClassroomApiDisabled(ex) {
  const reason = String(ex?.googleReason || "");
  const msg = String(ex?.message || "");
  if (reason === "ClassroomApiDisabled") return true;
  return /ClassroomApiDisabled|not permitted to access the Classroom API|SERVICE_DISABLED/i.test(
    `${reason} ${msg}`,
  );
}

function isReconnectableTokenError(ex) {
  if (isClassroomApiDisabled(ex)) return false;
  const code = String(ex?.code || "");
  const msg = String(ex?.message || "");
  const s = `${code} ${msg}`;
  return /missing_access_token|invalid_grant|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.?authentication.?scopes|insufficient.?scope/i.test(
    s,
  );
}

function logTurnInDiag(stage, extra = {}) {
  const parts = [`[Classroom turnIn] stage=${stage}`];
  if (extra.status != null) parts.push(`status=${extra.status}`);
  if (extra.code) parts.push(`code=${extra.code}`);
  if (extra.googleReason) parts.push(`reason=${extra.googleReason}`);
  if (extra.error) parts.push(`error=${String(extra.error).slice(0, 160)}`);
  console.warn(parts.join(" "));
}

async function recordMyClassroomSubmission(activityId, googleRow, turnedIn) {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "no_client" };
  const { data, error } = await sb.rpc("record_my_classroom_submission", {
    p_activity_id: activityId,
    p_row: googleRow || {},
    p_turned_in: !!turnedIn,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "persist_failed" };
  return { ok: true, result: data };
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

  const tok = await tryGetClassroomToken(userId);
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

    let associatedWithDeveloper = activity.classroom_associated_with_developer;
    let cwResult = null;

    if (courseWorkId) {
      cwResult = await patchCourseWork(tok, classroomCourseId, courseWorkId, payload);
      alreadyPublished = true;
    } else {
      cwResult = await createCourseWork(tok, classroomCourseId, payload);
      courseWorkId = cwResult.id;
      courseWorkUrl =
        cwResult.alternateLink ||
        `https://classroom.google.com/c/${classroomCourseId}/a/${courseWorkId}`;
    }

    if (cwResult && typeof cwResult.associatedWithDeveloper === "boolean") {
      associatedWithDeveloper = cwResult.associatedWithDeveloper;
    }

    const patch = {
      classroom_coursework_id: courseWorkId,
      classroom_coursework_url: courseWorkUrl,
      classroom_last_synced_at: new Date().toISOString(),
    };
    if (typeof associatedWithDeveloper === "boolean") {
      patch.classroom_associated_with_developer = associatedWithDeveloper;
    }

    const { error } = await sb.from("activities").update(patch).eq("id", activity.id);

    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      courseWorkId,
      url: courseWorkUrl,
      alreadyPublished,
      associatedWithDeveloper:
        typeof associatedWithDeveloper === "boolean" ? associatedWithDeveloper : null,
    };
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
  let tok;
  try {
    tok = await getValidClassroomToken(userId);
  } catch (ex) {
    return {
      ok: false,
      error: ex?.message || "missing_access_token",
      rows: [],
      persisted: 0,
      syncedAt: null,
      code: ex?.code,
    };
  }
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

  let tok;
  try {
    tok = await getValidClassroomToken(userId);
  } catch (ex) {
    return { ok: false, error: ex?.message || "missing_access_token", code: ex?.code };
  }
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
      const retMsg = String(retEx?.message || "");
      // Sin turnIn del alumno, return suele fallar
      if (/FAILED_PRECONDITION|not.?turned.?in|TURNED_IN|state/i.test(retMsg)) {
        await sb
          .from("activity_submissions")
          .update({
            classroom_grade_synced_at: new Date().toISOString(),
            classroom_grade_sync_error: null,
            classroom_submission_id: classroomSubmissionId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", submission.id);
        return {
          ok: true,
          warning:
            "Nota asignada en Classroom, pero no se pudo «devolver» porque el alumno aún no entregó en Classroom (turnIn).",
          error: null,
        };
      }
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
    const friendly = /FAILED_PRECONDITION|not.?turned.?in/i.test(msg)
      ? "Classroom exige que el alumno entregue primero (turnIn). Pedile que conecte Classroom y vuelva a entregar en PyBot."
      : msg;
    await sb
      .from("activity_submissions")
      .update({
        classroom_grade_sync_error: friendly,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submission.id);
    return { ok: false, error: friendly, code: ex?.code };
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

/** Mensaje claro post-entrega cuando falla el turnIn de Classroom. */
export function classroomTurnInUserMessage(classroomResult) {
  if (!classroomResult || classroomResult.skipped || classroomResult.ok) return null;

  if (classroomResult.needsAdmin || classroomResult.googleReason === "ClassroomApiDisabled") {
    return (
      "Actividad entregada en PyBot. Google Workspace no permite a esta cuenta usar la API de Classroom. " +
      "El administrador del colegio debe habilitar Classroom API para los alumnos."
    );
  }

  const err = String(classroomResult.error || "");
  if (err === "coursework_not_associated_with_developer") {
    return (
      "Actividad entregada en PyBot. Esta tarea de Classroom no fue creada por el proyecto de PyBot " +
      "y Google no permite que PyBot marque automáticamente la entrega."
    );
  }

  if (err === "classroom_submission_not_found" || err === "submission_not_found") {
    return (
      "Actividad entregada en PyBot. No se pudo actualizar Google Classroom en este momento."
    );
  }

  // needsConnect: la UI inicia OAuth automático; mensaje breve mientras tanto
  if (classroomResult.needsConnect) {
    return (
      "Actividad entregada en PyBot. Para marcarla también en Google Classroom necesitamos autorizar tu cuenta."
    );
  }

  const stageHint =
    classroomResult.stage && classroomResult.code
      ? ` (${classroomResult.stage}/${classroomResult.code})`
      : "";
  return `Actividad entregada en PyBot. No se pudo actualizar Google Classroom en este momento.${stageHint}`;
}

/** Mensaje de éxito (PyBot ± Classroom). */
export function classroomTurnInSuccessMessage(classroomResult) {
  if (!classroomResult || classroomResult.skipped) {
    return "Actividad entregada.";
  }
  if (!classroomResult.ok) return null;
  if (classroomResult.alreadyTurnedIn) {
    return "Actividad entregada en PyBot. Ya estaba entregada en Google Classroom.";
  }
  return "Actividad entregada en PyBot y en Google Classroom.";
}

function failTurnIn({ stage, error, code, googleReason, status, needsConnect, needsAdmin }) {
  logTurnInDiag(stage, { status, code, googleReason, error });
  return {
    ok: false,
    skipped: false,
    stage,
    error: error || "turn_in_failed",
    code: code || null,
    googleReason: googleReason || null,
    status: status ?? null,
    needsConnect: !!needsConnect,
    needsAdmin: !!needsAdmin,
  };
}

/**
 * Tras entregar en PyBot: turnIn de la StudentSubmission del alumno en Classroom.
 * Usa EXCLUSIVAMENTE token mode=student. No revierte la entrega PyBot.
 */
export async function turnInPybotActivityToClassroom(activityId) {
  const sb = getSupabase();
  if (!sb || !activityId) {
    return { ok: false, skipped: true, stage: "precheck", error: "missing_args" };
  }

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) {
    return { ok: false, skipped: true, stage: "precheck", error: "no_session" };
  }

  const { data: act, error: actErr } = await sb
    .from("activities")
    .select("id, course_id, classroom_coursework_id, classroom_associated_with_developer")
    .eq("id", activityId)
    .maybeSingle();

  if (actErr || !act) {
    return {
      ok: false,
      skipped: true,
      stage: "precheck",
      error: actErr?.message || "activity_not_found",
    };
  }
  if (!act.classroom_coursework_id) {
    return { ok: true, skipped: true, stage: "precheck", error: null };
  }

  const { data: course } = await sb
    .from("courses")
    .select("classroom_course_id")
    .eq("id", act.course_id)
    .maybeSingle();

  const classroomCourseId = course?.classroom_course_id;
  if (!classroomCourseId) {
    return { ok: true, skipped: true, stage: "precheck", error: null };
  }

  // --- token (student) ---
  let tok = null;
  try {
    tok = await getValidClassroomToken(user.id, { mode: "student" });
  } catch (ex) {
    if (isClassroomApiDisabled(ex)) {
      return failTurnIn({
        stage: "token",
        error: ex?.message || "ClassroomApiDisabled",
        code: ex?.code,
        googleReason: ex?.googleReason || "ClassroomApiDisabled",
        status: ex?.status,
        needsAdmin: true,
        needsConnect: false,
      });
    }
    if (isReconnectableTokenError(ex) || ex?.code === "invalid_grant") {
      return failTurnIn({
        stage: "token",
        error: ex?.message || "invalid_grant",
        code: ex?.code || "invalid_grant",
        googleReason: ex?.googleReason,
        status: ex?.status,
        needsConnect: true,
      });
    }
    return failTurnIn({
      stage: "token",
      error: ex?.message || "token_failed",
      code: ex?.code,
      googleReason: ex?.googleReason,
      status: ex?.status,
      needsConnect: isReconnectableTokenError(ex),
    });
  }

  if (!tok) {
    return failTurnIn({
      stage: "token",
      error: "missing_access_token",
      code: "missing_access_token",
      needsConnect: true,
    });
  }

  // --- precheck associatedWithDeveloper ---
  let associated = act.classroom_associated_with_developer;
  if (associated === false) {
    return failTurnIn({
      stage: "precheck",
      error: "coursework_not_associated_with_developer",
      code: "coursework_not_associated_with_developer",
      needsConnect: false,
    });
  }

  if (associated == null) {
    try {
      const cw = await getCourseWork(tok, classroomCourseId, act.classroom_coursework_id);
      if (typeof cw?.associatedWithDeveloper === "boolean") {
        associated = cw.associatedWithDeveloper;
        await sb
          .from("activities")
          .update({ classroom_associated_with_developer: associated })
          .eq("id", activityId);
      }
    } catch (ex) {
      if (isClassroomApiDisabled(ex)) {
        return failTurnIn({
          stage: "coursework",
          error: ex?.message || "ClassroomApiDisabled",
          code: ex?.code,
          googleReason: ex?.googleReason || "ClassroomApiDisabled",
          status: ex?.status,
          needsAdmin: true,
        });
      }
      if (isReconnectableTokenError(ex)) {
        return failTurnIn({
          stage: "coursework",
          error: ex?.message || "coursework_fetch_failed",
          code: ex?.code,
          googleReason: ex?.googleReason,
          status: ex?.status,
          needsConnect: true,
        });
      }
      // Si no pudimos leer associated, no inventamos: fallar sin loop OAuth
      return failTurnIn({
        stage: "coursework",
        error: ex?.message || "coursework_fetch_failed",
        code: ex?.code,
        googleReason: ex?.googleReason,
        status: ex?.status,
        needsConnect: false,
      });
    }

    if (associated === false) {
      return failTurnIn({
        stage: "precheck",
        error: "coursework_not_associated_with_developer",
        code: "coursework_not_associated_with_developer",
        needsConnect: false,
      });
    }
  }

  // --- localizar StudentSubmission ---
  let classroomSubmissionId = null;
  let googleRow = null;
  let priorState = null;

  const cached = await fetchCachedClassroomSubmissions(activityId);
  const mine = (cached.rows || []).find((r) => r.user_id === user.id);
  if (mine?.id) {
    classroomSubmissionId = mine.id;
    priorState = mine.state || null;
    googleRow = {
      id: mine.id,
      userId: mine.userId,
      courseWorkId: mine.courseWorkId || act.classroom_coursework_id,
      state: mine.state,
      late: mine.late,
      draftGrade: mine.draftGrade,
      assignedGrade: mine.assignedGrade,
      creationTime: mine.creationTime,
      updateTime: mine.updateTime,
    };
  }

  if (!classroomSubmissionId) {
    const { data: sub } = await sb
      .from("activity_submissions")
      .select("classroom_submission_id")
      .eq("activity_id", activityId)
      .eq("user_id", user.id)
      .maybeSingle();
    classroomSubmissionId = sub?.classroom_submission_id || null;
  }

  if (!classroomSubmissionId || !googleRow) {
    try {
      const mineRows = await listStudentSubmissions(
        tok,
        classroomCourseId,
        act.classroom_coursework_id,
        "me",
      );
      googleRow = mineRows?.[0] || null;
      if (googleRow?.id) {
        classroomSubmissionId = googleRow.id;
        priorState = googleRow.state || priorState;
        const persistList = await recordMyClassroomSubmission(activityId, googleRow, false);
        if (!persistList.ok) {
          console.warn("[Classroom turnIn] stage=list_submission persist warning:", persistList.error);
        }
      }
    } catch (ex) {
      if (isClassroomApiDisabled(ex)) {
        return failTurnIn({
          stage: "list_submission",
          error: ex?.message || "ClassroomApiDisabled",
          code: ex?.code,
          googleReason: ex?.googleReason || "ClassroomApiDisabled",
          status: ex?.status,
          needsAdmin: true,
        });
      }
      if (isReconnectableTokenError(ex)) {
        return failTurnIn({
          stage: "list_submission",
          error: ex?.message || "list_submissions_failed",
          code: ex?.code,
          googleReason: ex?.googleReason,
          status: ex?.status,
          needsConnect: true,
        });
      }
      return failTurnIn({
        stage: "list_submission",
        error: ex?.message || "list_submissions_failed",
        code: ex?.code,
        googleReason: ex?.googleReason,
        status: ex?.status,
        needsConnect: false,
      });
    }
  }

  if (!classroomSubmissionId) {
    return failTurnIn({
      stage: "list_submission",
      error: "classroom_submission_not_found",
      code: "submission_not_found",
      needsConnect: false,
    });
  }

  // Ya entregada / devuelta: no llamar turnIn
  if (priorState === "TURNED_IN" || priorState === "RETURNED") {
    return {
      ok: true,
      skipped: false,
      alreadyTurnedIn: true,
      classroomSubmissionId,
      stage: "list_submission",
      error: null,
    };
  }

  // --- turnIn ---
  try {
    await turnInStudentSubmission(
      tok,
      classroomCourseId,
      act.classroom_coursework_id,
      classroomSubmissionId,
    );
  } catch (ex) {
    const msg = String(ex?.message || "");
    const unequivocalAlready =
      /already.?turned.?in/i.test(msg) ||
      (ex?.code === "FAILED_PRECONDITION" && /already.?turned.?in/i.test(msg));

    if (unequivocalAlready || priorState === "TURNED_IN") {
      return {
        ok: true,
        skipped: false,
        alreadyTurnedIn: true,
        classroomSubmissionId,
        stage: "turn_in",
        error: null,
      };
    }

    if (isClassroomApiDisabled(ex)) {
      return failTurnIn({
        stage: "turn_in",
        error: msg || "ClassroomApiDisabled",
        code: ex?.code,
        googleReason: ex?.googleReason || "ClassroomApiDisabled",
        status: ex?.status,
        needsAdmin: true,
      });
    }
    if (isReconnectableTokenError(ex)) {
      return failTurnIn({
        stage: "turn_in",
        error: msg || "turn_in_failed",
        code: ex?.code,
        googleReason: ex?.googleReason,
        status: ex?.status,
        needsConnect: true,
      });
    }
    return failTurnIn({
      stage: "turn_in",
      error: msg || "turn_in_failed",
      code: ex?.code,
      googleReason: ex?.googleReason,
      status: ex?.status,
      needsConnect: false,
    });
  }

  // --- persist TURNED_IN via RPC (no UPDATE directo) ---
  const persistRow = googleRow || {
    id: classroomSubmissionId,
    courseWorkId: act.classroom_coursework_id,
    state: "TURNED_IN",
  };
  const persist = await recordMyClassroomSubmission(activityId, persistRow, true);
  if (!persist.ok) {
    logTurnInDiag("persist", { error: persist.error });
    return {
      ok: true,
      skipped: false,
      classroomSubmissionId,
      stage: "persist",
      warning: "cache_persist_failed",
      error: null,
    };
  }

  return {
    ok: true,
    skipped: false,
    classroomSubmissionId,
    stage: "persist",
    error: null,
  };
}
