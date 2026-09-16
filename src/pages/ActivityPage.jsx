import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AssignedContentSnapshotViewer from "../components/content-editor/AssignedContentSnapshotViewer.jsx";
import AssignedLessonViewer from "../components/content-editor/AssignedLessonViewer.jsx";
import {
  hasSavedLessonDocument,
  legacyBlocksToDocument,
  normalizeLessonDocument,
} from "../components/content-editor/legacyLessonDocument.js";
import SubmissionCodeViewer from "../components/pybotclass/SubmissionCodeViewer.jsx";
import PyBotClassShell, { PyBotClassBreadcrumb } from "../components/pybotclass/PyBotClassShell.jsx";
import {
  PbcAlert,
  PbcCourseHeader,
  PbcEmpty,
  PbcLoading,
  PbcPage,
  PbcSection,
} from "../components/pybotclass/PyBotClassUi.jsx";
import {
  ACTIVITY_ID_QUERY,
  ACTIVITY_LAUNCH_STATE_KEY,
  resolveActivityEditorCode,
} from "../platform/activityIdeSession.js";
import { writeActivityLaunchCache } from "../platform/courseActivityApi.js";
import { fetchActivityProgress } from "../platform/activityProgress.js";
import {
  closeSubmission,
  fetchActiveReopen,
  fetchActivityRubric,
  fetchActivitySubmissions,
  fetchMySubmission,
  fetchSubmissionRubricScores,
  gradeSubmission,
  reopenSubmissionForStudent,
  requestSubmissionReview,
  submissionStatusLabelEs,
  submissionVersionLabel,
  submitActivity,
  upsertActivityRubric,
} from "../platform/activitySubmissions.js";
import {
  canStudentSubmit,
  deriveProcessStatus,
  deriveSubmissionWindow,
  deriveTimeliness,
  processStatusLabelEs,
  studentNextActionMessage,
  sumRubricPoints,
  timelinessLabelEs,
  windowLabelEs,
} from "../platform/submissionWorkflow.js";
import {
  connectGoogleClassroom,
  getPendingClassroomTurnIn,
  setPendingClassroomTurnIn,
  clearPendingClassroomTurnIn,
} from "../platform/googleOAuth.js";
import { fetchProfile, getStoredStudentClassroomLink } from "../platform/profileApi.js";
import {
  fetchCachedClassroomSubmissions,
  publishActivityToClassroom,
  sendGradeToClassroom,
  syncClassroomSubmissionsForActivity,
  classroomGradeSyncUserMessage,
  classroomTurnInUserMessage,
  classroomTurnInSuccessMessage,
  turnInPybotActivityToClassroom,
} from "../platform/activityClassroom.js";
import { fetchAssignedLessonDocument } from "../platform/contentAssignApi.js";
import { listLessonBlocks } from "../platform/contentApi.js";
import { canTeachCourse, fetchMyCourseRole, isCourseStudent } from "../platform/courseRole.js";
import { fetchMyOrgRole } from "../orgRole.js";
import { isSuperAdmin } from "../platformRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { track } from "../telemetry/index.js";

function fmtTs(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("es-AR");
  } catch {
    return String(v);
  }
}

export default function ActivityPage() {
  const { activityId } = useParams();
  const [searchParams] = useSearchParams();
  const focusStudentId = searchParams.get("alumno") || "";
  const navigate = useNavigate();
  const loginPath = `/actividad/${activityId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [activity, setActivity] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [classroomCourseId, setClassroomCourseId] = useState(null);
  const [classroomSubs, setClassroomSubs] = useState([]);
  const [classroomSyncedAt, setClassroomSyncedAt] = useState(null);
  const [progressHint, setProgressHint] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [orgRole, setOrgRole] = useState(null);
  const [courseRole, setCourseRole] = useState(null);
  const [mySubmission, setMySubmission] = useState(null);
  const [teacherRows, setTeacherRows] = useState([]);
  const [teacherHistoryByUser, setTeacherHistoryByUser] = useState(new Map());
  const [profilesById, setProfilesById] = useState(new Map());
  const [viewCode, setViewCode] = useState(null);
  const [viewHistoryId, setViewHistoryId] = useState(null);
  const [gradeDraft, setGradeDraft] = useState({});
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [rubricDraftBySubmission, setRubricDraftBySubmission] = useState({});
  const [myRubricScores, setMyRubricScores] = useState([]);
  const [reopenActive, setReopenActive] = useState(false);
  const [rubricEditor, setRubricEditor] = useState([]);
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [needsClassroomConnect, setNeedsClassroomConnect] = useState(false);
  const [classroomLinked, setClassroomLinked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lessonDoc, setLessonDoc] = useState(null);
  const [lessonMeta, setLessonMeta] = useState(null);
  const [lessonErr, setLessonErr] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [superAdmin, setSuperAdmin] = useState(false);
  const focusRowRef = useRef(null);
  const didFocusStudent = useRef(false);

  const canTeach = canTeachCourse({ orgRole, courseRole });
  const isStudent = isCourseStudent({ courseRole });
  const activityKind = activity?.activity_kind || (activity?.content_snapshot ? "material" : "exercise");
  const isMaterial = activityKind === "material";
  const isCodingActivity = activityKind === "exercise" || activityKind === "task";

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  useEffect(() => {
    if (activityId) track("activity_open", { feature: "activity" });
  }, [activityId]);

  const load = useCallback(async (opts = {}) => {
    if (!supabase || !activityId || !user) return;
    const preserveActionMsg = Boolean(opts.preserveActionMsg);
    setLoadErr("");
    setLoading(true);
    if (!preserveActionMsg) {
      setActionMsg("");
      setActionErr("");
    }
    let { data: act, error: eAct } = await supabase
      .from("activities")
      .select(
        "id, title, description, starter_code, pybot_lesson_id, content_lesson_id, content_snapshot, content_source_type, content_source_id, activity_kind, course_id, due_at, submission_close_at, max_points, created_at",
      )
      .eq("id", activityId)
      .maybeSingle();

    if (eAct) {
      const fb = await supabase
        .from("activities")
        .select("id, title, description, pybot_lesson_id, course_id, created_at, starter_code, content_lesson_id")
        .eq("id", activityId)
        .maybeSingle();
      act = fb.data;
      eAct = fb.error;
    }

    // Campos Classroom (migración 028) — best effort
    if (act?.id) {
      const cw = await supabase
        .from("activities")
        .select("classroom_coursework_id, classroom_coursework_url")
        .eq("id", activityId)
        .maybeSingle();
      if (!cw.error && cw.data) {
        act = { ...act, ...cw.data };
      }
    }

    if (eAct) {
      setLoadErr(eAct.message);
      setLoading(false);
      return;
    }
    if (!act) {
      setLoadErr("Actividad no encontrada o sin permiso.");
      setLoading(false);
      return;
    }

    setActivity(act);
    setLessonDoc(null);
    setLessonMeta(null);
    setLessonErr("");
    setSnapshot(act.content_snapshot || null);

    if (!act.content_snapshot && act.content_lesson_id) {
      const { lesson, document, error: lessonLoadErr } = await fetchAssignedLessonDocument(
        act.content_lesson_id,
      );
      if (lessonLoadErr) {
        setLessonErr(lessonLoadErr);
      } else if (lesson) {
        setLessonMeta(lesson);
        if (hasSavedLessonDocument(document)) {
          setLessonDoc(normalizeLessonDocument(document));
        } else {
          const { rows: blocks } = await listLessonBlocks(act.content_lesson_id);
          setLessonDoc(normalizeLessonDocument(legacyBlocksToDocument(blocks)));
        }
      }
    }

    let nextOrgRole = null;
    let nextCourseRole = null;
    let nextOrgId = null;
    let nextClassroomCourseId = null;

    if (act.course_id) {
      const { data: course } = await supabase
        .from("courses")
        .select("title, org_id, classroom_course_id")
        .eq("id", act.course_id)
        .maybeSingle();
      setCourseTitle(course?.title ?? "");
      nextOrgId = course?.org_id ?? null;
      nextClassroomCourseId = course?.classroom_course_id ?? null;
      setClassroomCourseId(nextClassroomCourseId);

      if (nextOrgId) {
        nextOrgRole = await fetchMyOrgRole(supabase, nextOrgId, user.id);
        setOrgRole(nextOrgRole);
      }
      nextCourseRole = await fetchMyCourseRole(supabase, act.course_id, user.id);
      setCourseRole(nextCourseRole);
    }

    const { profile } = await fetchProfile(user.id);
    setSuperAdmin(isSuperAdmin(profile));

    const prog = await fetchActivityProgress(activityId, user.id);
    const launchCode = resolveActivityEditorCode({
      starterCode: act.starter_code,
      savedCode: prog.code,
      launchCode: "",
    });
    if (prog.error) {
      setProgressHint("");
      setSavedCode(false);
    } else if (prog.code && prog.code.length > 0) {
      setSavedCode(true);
      setProgressHint("Tenés código guardado en la nube para esta actividad.");
    } else if (act.starter_code && act.starter_code.length > 0) {
      setSavedCode(false);
      setProgressHint("Al abrir PyBot vas a ver el código inicial de esta tarea.");
    } else {
      setSavedCode(false);
      setProgressHint("Todavía no hay progreso guardado en la nube.");
    }

    writeActivityLaunchCache(activityId, launchCode);

    const teach = canTeachCourse({ orgRole: nextOrgRole, courseRole: nextCourseRole });
    const student = isCourseStudent({ courseRole: nextCourseRole });

    if (student) {
      const sub = await fetchMySubmission(activityId, user.id);
      setMySubmission(sub.submission);

      const { reopen } = await fetchActiveReopen(activityId, user.id);
      setReopenActive(Boolean(reopen?.active));

      if (sub.submission?.id && (sub.submission.status === "graded" || sub.submission.status === "closed")) {
        const { scores } = await fetchSubmissionRubricScores(sub.submission.id);
        setMyRubricScores(scores);
      } else {
        setMyRubricScores([]);
      }

      if (act.classroom_coursework_id && nextClassroomCourseId) {
        const stored = await getStoredStudentClassroomLink(user.id);
        const linked = !!(
          stored?.classroom_student_linked_at ||
          stored?.google_student_refresh_token
        );
        setClassroomLinked(linked);
        setNeedsClassroomConnect(false);
      } else {
        setClassroomLinked(null);
        setNeedsClassroomConnect(false);
      }
    } else {
      setMySubmission(null);
      setMyRubricScores([]);
      setReopenActive(false);
      setClassroomLinked(null);
      setNeedsClassroomConnect(false);
    }

    const { criteria } = await fetchActivityRubric(activityId);
    setRubricCriteria(criteria || []);
    setRubricEditor(
      (criteria || []).map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || "",
        max_points: String(c.max_points),
      })),
    );

    if (teach) {
      const list = await fetchActivitySubmissions(activityId);
      setTeacherRows(list.rows ?? []);
      const hist = new Map();
      for (const row of list.allRows ?? []) {
        if (!row?.user_id) continue;
        const arr = hist.get(row.user_id) || [];
        arr.push(row);
        hist.set(row.user_id, arr);
      }
      setTeacherHistoryByUser(hist);
      const ids = [...new Set((list.rows ?? []).map((r) => r.user_id))];
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", ids);
        const map = new Map();
        for (const p of profiles ?? []) map.set(p.id, p);
        setProfilesById(map);
      } else {
        setProfilesById(new Map());
      }

      // Cache persistente Classroom (sin llamar a Google en F5)
      if (act.classroom_coursework_id) {
        const cached = await fetchCachedClassroomSubmissions(activityId);
        if (cached.ok) {
          setClassroomSubs(cached.rows ?? []);
          setClassroomSyncedAt(cached.syncedAt ?? null);
        }
      } else {
        setClassroomSubs([]);
        setClassroomSyncedAt(null);
      }
    } else {
      setTeacherRows([]);
      setClassroomSubs([]);
      setClassroomSyncedAt(null);
    }

    setLoading(false);
  }, [supabase, activityId, user]);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  // Deep-link desde tab Entregas: ?alumno= → abrir código de esa entrega
  useEffect(() => {
    didFocusStudent.current = false;
  }, [focusStudentId, activityId]);

  useEffect(() => {
    if (loading || !canTeach || !focusStudentId || didFocusStudent.current) return;
    const row = teacherRows.find((r) => r.user_id === focusStudentId);
    if (!row) return;
    didFocusStudent.current = true;
    setViewCode(row.id);
    setViewHistoryId(null);
    requestAnimationFrame(() => {
      focusRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, canTeach, focusStudentId, teacherRows]);

  // Resume turnIn post-OAuth (sin re-submit)
  useEffect(() => {
    if (authLoading || loading || !user || !activityId || !isStudent) return;
    const pending = getPendingClassroomTurnIn();
    if (!pending) return;
    if (pending.activityId !== activityId || pending.userId !== user.id) return;

    let cancelled = false;
    (async () => {
      clearPendingClassroomTurnIn();
      setBusy(true);
      setActionErr("");
      setActionMsg("Completando entrega en Google Classroom…");
      try {
        const cr = await turnInPybotActivityToClassroom(activityId);
        if (cancelled) return;
        await load({ preserveActionMsg: true });
        if (cr?.needsConnect && !cr?.needsAdmin) {
          setActionMsg(classroomTurnInUserMessage(cr) || "No se pudo completar Classroom.");
          return;
        }
        const okMsg = classroomTurnInSuccessMessage(cr);
        const failMsg = classroomTurnInUserMessage(cr);
        setActionMsg(failMsg || okMsg || "Actividad entregada.");
      } catch (ex) {
        if (cancelled) return;
        setActionErr(ex?.message || "No se pudo completar la entrega en Classroom.");
        setActionMsg("");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, loading, user, activityId, isStudent, load]);

  const openPyBot = () => {
    if (!activityId || !activity || !user) return;
    void fetchActivityProgress(activityId, user.id).then((prog) => {
      const launchCode = resolveActivityEditorCode({
        starterCode: activity.starter_code,
        savedCode: prog.code,
        launchCode: "",
      });
      writeActivityLaunchCache(activityId, launchCode);
      navigate(`/?${ACTIVITY_ID_QUERY}=${encodeURIComponent(activityId)}`, {
        state: { [ACTIVITY_LAUNCH_STATE_KEY]: launchCode },
      });
    });
  };

  const onPublishClassroom = async () => {
    if (!activity || !classroomCourseId || !user || busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await publishActivityToClassroom({
      activity,
      classroomCourseId,
      userId: user.id,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo publicar en Classroom.");
      return;
    }
    setActionMsg(r.alreadyPublished ? "Ya estaba publicada en Classroom." : "Publicada en Classroom.");
    await load();
  };

  const onSyncClassroom = async () => {
    if (!activity?.classroom_coursework_id || !classroomCourseId || !user || busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await syncClassroomSubmissionsForActivity({
      activityId: activity.id,
      classroomCourseId,
      courseWorkId: activity.classroom_coursework_id,
      userId: user.id,
    });
    setBusy(false);
    if (!r.ok) {
      const msg = r.error || "No se pudo sincronizar Classroom.";
      if (/guardar|persist|forbidden|invalid_rows|missing_activity/i.test(String(msg))) {
        setActionErr("No se pudieron guardar las entregas sincronizadas.");
      } else {
        setActionErr(msg);
      }
      return;
    }
    setClassroomSubs(r.rows ?? []);
    setClassroomSyncedAt(r.syncedAt ?? new Date().toISOString());
    const n = r.persisted ?? r.rows?.length ?? 0;
    setActionMsg(
      `Classroom sincronizado: ${n} entrega${n === 1 ? "" : "s"} actualizada${n === 1 ? "" : "s"}. Las entregas de Classroom se registran por separado de las entregas PyBot.`,
    );
  };

  const resolveClassroomSubmissionId = async (row) => {
    let classroomSubmissionId = row.classroom_submission_id || null;
    if (!classroomSubmissionId) {
      const byUserId = classroomSubs.find((cs) => cs.user_id && cs.user_id === row.user_id);
      if (byUserId?.id) classroomSubmissionId = byUserId.id;
    }
    if (!classroomSubmissionId && activity?.course_id) {
      const { data: cm } = await supabase
        .from("course_members")
        .select("classroom_user_id")
        .eq("course_id", activity.course_id)
        .eq("user_id", row.user_id)
        .maybeSingle();
      const googleUid = cm?.classroom_user_id;
      if (googleUid) {
        const cached = await fetchCachedClassroomSubmissions(activity.id);
        const fromDb = (cached.rows || []).find((cs) => cs.userId === googleUid);
        classroomSubmissionId = fromDb?.id || null;
        if (!classroomSubmissionId) {
          const found = classroomSubs.find((cs) => cs.userId === googleUid);
          classroomSubmissionId = found?.id || null;
        }
      }
    }
    return classroomSubmissionId;
  };

  const onSendGradeClassroom = async (row) => {
    if (!activity?.classroom_coursework_id || !classroomCourseId || !user || busy) return;
    const classroomSubmissionId = await resolveClassroomSubmissionId(row);
    if (!classroomSubmissionId) {
      setActionErr(
        "No se encontró la entrega Classroom del alumno. Primero «Sincronizar entregas Classroom».",
      );
      return;
    }
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await sendGradeToClassroom({
      submission: row,
      activity,
      classroomCourseId,
      courseWorkId: activity.classroom_coursework_id,
      classroomSubmissionId,
      userId: user.id,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo enviar la nota a Classroom.");
      return;
    }
    setActionMsg(
      classroomGradeSyncUserMessage({
        warning: r.warning || null,
        hasFeedback: Boolean(row.feedback) && r.feedbackSynced !== true,
      }),
    );
    await load({ preserveActionMsg: true });
  };

  const onSubmit = async () => {
    if (!activityId || !user || busy) return;
    if (!window.confirm("¿Entregar esta actividad?")) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    setNeedsClassroomConnect(false);
    const prog = await fetchActivityProgress(activityId, user.id);
    const code = prog.code ?? activity?.starter_code ?? "";
    const r = await submitActivity(activityId, code);
    if (!r.ok) {
      setBusy(false);
      const msg =
        r.error === "submissions_closed"
          ? "Las entregas están cerradas. Pedile al docente una reapertura individual."
          : r.error || "No se pudo entregar.";
      setActionErr(msg);
      return;
    }
    await load({ preserveActionMsg: true });
    const cr = r.classroom;
    if (cr?.ok === false && cr?.needsConnect && !cr?.needsAdmin) {
      setPendingClassroomTurnIn({
        activityId,
        userId: user.id,
        returnPath: `/actividad/${activityId}`,
      });
      setActionMsg(
        classroomTurnInUserMessage(cr) ||
          "Actividad entregada en PyBot. Autorizá Google Classroom para completar la entrega.",
      );
      setBusy(false);
      void connectGoogleClassroom(`/actividad/${activityId}`, { mode: "student" });
      return;
    }
    setBusy(false);
    const lateNote = r.submission?.late ? " (tarde)" : "";
    const okMsg = classroomTurnInSuccessMessage(cr);
    const failMsg = classroomTurnInUserMessage(cr);
    setActionMsg(failMsg || okMsg || `Actividad entregada${lateNote}.`);
  };

  const onRequestReview = async (submissionId) => {
    if (busy) return;
    const draft = gradeDraft[submissionId] || {};
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await requestSubmissionReview(submissionId, draft.feedback || null);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo solicitar la revisión.");
      return;
    }
    setActionMsg("Revisión solicitada. El alumno puede corregir y reentregar.");
    await load({ preserveActionMsg: true });
  };

  const onGrade = async (submissionId) => {
    if (busy) return;
    const draft = { ...(gradeDraft[submissionId] || {}) };
    const row = teacherRows.find((r) => r.id === submissionId);
    setBusy(true);
    setActionErr("");
    setActionMsg("");

    let rubricScores = null;
    if (rubricCriteria.length > 0) {
      const rd = rubricDraftBySubmission[submissionId] || {};
      rubricScores = rubricCriteria.map((c) => ({
        criterion_id: c.id,
        points: Number(rd[c.id]?.points ?? 0),
        comment: rd[c.id]?.comment || null,
      }));
      draft.grade = sumRubricPoints(rubricScores);
    }

    const r = await gradeSubmission(
      submissionId,
      draft.grade,
      draft.feedback,
      rubricScores,
    );
    if (!r.ok) {
      setBusy(false);
      setActionErr(r.error || "No se pudo guardar la evaluación.");
      return;
    }

    let msg = "Evaluación guardada en PyBotClass.";
    if (activity?.classroom_coursework_id && classroomCourseId && row) {
      const gradedRow = {
        ...row,
        grade: r.result?.grade ?? Number(draft.grade),
        feedback: draft.feedback,
      };
      const classroomSubmissionId = await resolveClassroomSubmissionId(gradedRow);
      if (classroomSubmissionId) {
        const sync = await sendGradeToClassroom({
          submission: gradedRow,
          activity,
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          classroomSubmissionId,
          userId: user.id,
        });
        if (sync.ok) {
          msg = classroomGradeSyncUserMessage({
            warning: sync.warning || null,
            hasFeedback: Boolean(draft.feedback) && sync.feedbackSynced !== true,
          });
        } else {
          msg = `Evaluación guardada en PyBotClass. Sync Classroom pendiente: ${sync.error || "error"}. Podés reintentar.`;
        }
      } else {
        msg =
          "Evaluación guardada en PyBotClass. Sync Classroom pendiente: falta StudentSubmission (sincronizá entregas).";
      }
    }

    setBusy(false);
    setActionMsg(msg);
    await load({ preserveActionMsg: true });
  };

  const onCloseSubmission = async (submissionId) => {
    if (busy) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await closeSubmission(submissionId);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo cerrar.");
      return;
    }
    setActionMsg("Corrección cerrada.");
    await load({ preserveActionMsg: true });
  };

  const onReopen = async (userId) => {
    if (busy || !activityId) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await reopenSubmissionForStudent(activityId, userId);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo reabrir.");
      return;
    }
    setActionMsg("Entrega reabierta para este alumno (revisión solicitada).");
    await load({ preserveActionMsg: true });
  };

  const onSaveRubric = async () => {
    if (busy || !activityId) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const criteria = rubricEditor
      .filter((c) => String(c.name || "").trim())
      .map((c) => ({
        name: String(c.name).trim(),
        description: c.description || null,
        max_points: Number(c.max_points),
      }));
    const r = await upsertActivityRubric(activityId, criteria);
    setBusy(false);
    if (!r.ok) {
      setActionErr(
        r.error === "rubric_max_mismatch"
          ? `La suma de la rúbrica debe ser igual al puntaje máximo (${activity?.max_points}).`
          : r.error || "No se pudo guardar la rúbrica.",
      );
      return;
    }
    setActionMsg("Rúbrica guardada.");
    await load({ preserveActionMsg: true });
  };

  if (authLoading) {
    return (
      <main className="dash-root dash-root--center">
        <PbcLoading label="Cargando actividad…" />
      </main>
    );
  }

  if (!user) return null;

  if (loading) {
    return (
      <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
        <PbcPage>
          <PbcLoading label="Cargando actividad…" />
        </PbcPage>
      </PyBotClassShell>
    );
  }

  const courseHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}`
    : "/dashboard/classes";
  const entregasHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}?tab=entregas`
    : "/dashboard/classes";
  const actividadesHref = activity?.course_id
    ? `/dashboard/classes/${activity.course_id}?tab=actividades`
    : "/dashboard/classes";

  const breadcrumbItems = [];
  if (activity?.course_id) {
    breadcrumbItems.push({ label: courseTitle || "Curso", href: courseHref });
    if (canTeach) {
      breadcrumbItems.push({ label: "Entregas", href: entregasHref });
    }
  }
  breadcrumbItems.push({ label: activity?.title || "Actividad" });

  const myProcess = deriveProcessStatus({
    status: mySubmission?.status,
    version: mySubmission?.version,
    hasSubmission: Boolean(mySubmission),
  });
  const myTimeliness = deriveTimeliness({
    submittedAt: mySubmission?.submitted_at,
    dueAt: activity?.due_at,
  });
  const myWindow = deriveSubmissionWindow({
    closeAt: activity?.submission_close_at,
    reopenActive,
  });
  const studentCanSubmit =
    isStudent &&
    isCodingActivity &&
    canStudentSubmit({
      processStatus: myProcess,
      windowStatus: myWindow,
      reopenActive,
    });

  if (loadErr) {
    return (
      <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
        <PbcPage>
          <PyBotClassBreadcrumb items={[{ label: "Actividad" }]} />
          <PbcCourseHeader title="Actividad" />
          <PbcAlert variant="error">{loadErr}</PbcAlert>
          <div className="pbc-footer-links">
            <Link to="/dashboard/classes" className="auth-link">
              ← Mis clases
            </Link>
          </div>
        </PbcPage>
      </PyBotClassShell>
    );
  }

  return (
    <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
      <PbcPage>
        <PyBotClassBreadcrumb items={breadcrumbItems} />

        <PbcCourseHeader
          title={activity?.title || "Actividad"}
          orgName={courseTitle || undefined}
          roleLabel={canTeach ? "Docente" : isStudent ? "Alumno" : undefined}
          classroomLinked={!!activity?.classroom_coursework_id}
        />

        {profileError ? <PbcAlert variant="error">{profileError}</PbcAlert> : null}
        {actionErr ? <PbcAlert variant="error">{actionErr}</PbcAlert> : null}
        {actionMsg ? <PbcAlert variant="info">{actionMsg}</PbcAlert> : null}

        <PbcSection
          className="pbc-activity-overview"
          title="Detalle"
          description={
            canTeach
              ? "Revisión y corrección de la actividad en el contexto del curso."
              : "Consigna, material y entrega de la actividad."
          }
          actions={
            <div className="pbc-activity-actions">
              {isCodingActivity ? (
                <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={openPyBot}>
                  Abrir PyBot
                </button>
              ) : null}
              {isStudent && isCodingActivity ? (
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  disabled={busy || !studentCanSubmit}
                  onClick={() => void onSubmit()}
                >
                  {busy ? "Entregando…" : "Entregar actividad"}
                </button>
              ) : null}
              <Link to={courseHref} className="auth-btn auth-btn--ghost auth-btn--sm">
                Volver al curso
              </Link>
            </div>
          }
        >
          {canTeach ? (
            <div className="pbc-activity-meta" aria-label="Configuración de la actividad">
              <p className="auth-card__muted" style={{ margin: 0 }}>
                Fecha de entrega: {activity?.due_at ? fmtTs(activity.due_at) : "Sin fecha"}
              </p>
              <p className="auth-card__muted" style={{ margin: 0 }}>
                Cierre de entregas:{" "}
                {activity?.submission_close_at
                  ? fmtTs(activity.submission_close_at)
                  : "Sin cierre (se permite entrega tarde tras la fecha límite)"}
              </p>
              {activity?.max_points != null ? (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  Puntaje máximo: {activity.max_points}
                </p>
              ) : activity?.course_id ? (
                <p className="auth-card__muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                  Definí el puntaje máximo en{" "}
                  <Link to={actividadesHref} className="auth-link">
                    Actividades
                  </Link>{" "}
                  (requerido para enviar notas a Classroom).
                </p>
              ) : (
                <p className="auth-card__muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                  Requerido definir puntaje máximo en Actividades para enviar notas a Classroom.
                </p>
              )}
            </div>
          ) : (
            <div className="pbc-activity-meta">
              <p className="auth-card__muted" style={{ margin: 0 }}>
                {activity?.due_at ? `Fecha límite: ${fmtTs(activity.due_at)}` : "Sin fecha límite"}
                {activity?.submission_close_at
                  ? ` · Cierre: ${fmtTs(activity.submission_close_at)}`
                  : " · Sin cierre de entregas"}
                {activity?.max_points != null ? ` · Máximo: ${activity.max_points}` : ""}
              </p>
              <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                Ventana: <strong>{windowLabelEs(myWindow)}</strong>
                {myTimeliness !== "sin_dato" ? (
                  <>
                    {" "}
                    · Puntualidad: <strong>{timelinessLabelEs(myTimeliness)}</strong>
                  </>
                ) : null}
              </p>
            </div>
          )}

          {isStudent && activity?.classroom_coursework_id && classroomCourseId ? (
            <div className="pbc-activity-classroom-hint">
              {classroomLinked ? (
                <span className="auth-card__muted">Cuenta Google Classroom vinculada</span>
              ) : (
                <p className="auth-card__muted" style={{ margin: 0 }}>
                  Esta actividad está vinculada a Google Classroom. Al entregar, PyBot intentará marcarla
                  también allí (puede pedirte autorización de Google).
                </p>
              )}
            </div>
          ) : null}

          {activity?.description ? (
            <p className="pbc-activity-description">{activity.description}</p>
          ) : (
            <p className="auth-card__muted">Sin descripción.</p>
          )}

          {activity?.content_snapshot || activity?.content_lesson_id ? (
            <p className="auth-card__muted">
              {isMaterial ? "Material de Mi Contenido" : "Actividad desde Mi Contenido"}
              {activity?.content_snapshot?.title ? `: ${activity.content_snapshot.title}` : ""}
              {lessonMeta?.title && !activity?.content_snapshot ? `: ${lessonMeta.title}` : ""}
            </p>
          ) : activity?.pybot_lesson_id ? (
            <p className="auth-card__muted">
              Lección PyBot (referencia): <code>{activity.pybot_lesson_id}</code>
            </p>
          ) : null}

          {lessonErr ? (
            <PbcAlert variant="error">No se pudo cargar el documento de la lección: {lessonErr}</PbcAlert>
          ) : null}

          {snapshot ? (
            <section className="pbc-activity-lesson" aria-label="Contenido asignado">
              <h2 className="pbc-activity-lesson__title">
                {isMaterial ? "Material" : activityKind === "task" ? "Tarea" : "Ejercicio"}
              </h2>
              <AssignedContentSnapshotViewer snapshot={snapshot} />
            </section>
          ) : lessonDoc && activity?.content_lesson_id ? (
            <section className="pbc-activity-lesson" aria-label="Contenido de la lección">
              <h2 className="pbc-activity-lesson__title">Lección</h2>
              <AssignedLessonViewer
                key={activity.content_lesson_id}
                lessonId={activity.content_lesson_id}
                initialContent={lessonDoc}
              />
            </section>
          ) : null}

          {!isMaterial ? <p className="auth-card__muted">{progressHint}</p> : null}

          {isStudent && isCodingActivity ? (
            <div className="pbc-activity-my-submission">
              <p className="auth-card__muted" style={{ margin: 0 }}>
                Estado: <strong>{processStatusLabelEs(myProcess)}</strong>
                {submissionVersionLabel(mySubmission?.version)
                  ? ` · ${submissionVersionLabel(mySubmission.version)}`
                  : null}
                {mySubmission?.submitted_at ? ` · ${fmtTs(mySubmission.submitted_at)}` : null}
              </p>
              <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                {studentNextActionMessage(myProcess)}
              </p>
              {!studentCanSubmit && myWindow === "cerrada" ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  Las entregas están cerradas.
                </p>
              ) : null}
              {myProcess === "revision_solicitada" && mySubmission?.feedback ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  Tu docente solicitó una revisión. Feedback: {mySubmission.feedback}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") && mySubmission?.grade != null ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  Nota: <strong>{mySubmission.grade}</strong>
                  {activity?.max_points != null ? ` / ${activity.max_points}` : null}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") && mySubmission?.feedback ? (
                <p className="auth-card__muted" style={{ margin: "0.35rem 0 0" }}>
                  Feedback: {mySubmission.feedback}
                </p>
              ) : null}
              {(myProcess === "evaluado" || myProcess === "cerrado") &&
              rubricCriteria.length > 0 &&
              myRubricScores.length > 0 ? (
                <ul className="pbc-activity-rubric-student" style={{ marginTop: "0.5rem" }}>
                  {rubricCriteria.map((c) => {
                    const sc = myRubricScores.find((s) => s.criterion_id === c.id);
                    return (
                      <li key={c.id} className="auth-card__muted">
                        <strong>{c.name}</strong>: {sc?.points ?? "—"} / {c.max_points}
                        {sc?.comment ? ` — ${sc.comment}` : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}

          {isCodingActivity ? (
            <p className="auth-card__muted">
              {canTeach
                ? "«Abrir PyBot» abre el IDE con el código inicial o tu progreso (para probar la consigna). El código del alumno se ve en cada entrega."
                : savedCode
                  ? "El autosave guarda progreso; «Entregar» registra la entrega formal."
                  : activity?.starter_code
                    ? "PyBot abre con el código inicial. Usá «Entregar» cuando termines."
                    : "Trabajá en el IDE y entregá cuando estés listo."}
            </p>
          ) : (
            <p className="auth-card__muted">Este material es de solo lectura. No requiere entrega de código.</p>
          )}
        </PbcSection>

        {canTeach && classroomCourseId ? (
          <PbcSection
            title="Google Classroom"
            description="Publicación, sincronización de entregas y envío de notas (sin reescribir el mecanismo actual)."
          >
            <div className="pbc-activity-actions pbc-activity-actions--wrap">
              {activity?.classroom_coursework_id ? (
                <>
                  <span className="auth-card__muted">Vinculada a Classroom (sincronización externa)</span>
                  {activity.classroom_coursework_url ? (
                    <a
                      className="auth-link"
                      href={activity.classroom_coursework_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir courseWork
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="auth-btn auth-btn--ghost auth-btn--sm"
                    disabled={busy}
                    onClick={() => void onSyncClassroom()}
                  >
                    Sincronizar entregas Classroom
                  </button>
                  <span className="auth-card__muted" style={{ fontSize: "0.85rem" }}>
                    {classroomSyncedAt
                      ? `Última sincronización: ${fmtTs(classroomSyncedAt)}`
                      : "Sin sincronizar aún"}
                    {classroomSubs.length
                      ? ` · ${classroomSubs.length} StudentSubmission${classroomSubs.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  disabled={busy}
                  onClick={() => void onPublishClassroom()}
                >
                  Publicar en Classroom
                </button>
              )}
            </div>
          </PbcSection>
        ) : null}

        {canTeach ? (
          <PbcSection
            title="Rúbrica (opcional)"
            description="La suma de los máximos de cada criterio debe coincidir con el puntaje máximo de la actividad."
          >
            {rubricEditor.length === 0 ? (
              <p className="auth-card__muted">Sin rúbrica. Agregá criterios si querés evaluar por rúbrica.</p>
            ) : null}
            {rubricEditor.map((c, idx) => (
              <div
                key={c.id || idx}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr auto", gap: "0.5rem", marginBottom: "0.5rem" }}
              >
                <input
                  className="auth-org-input"
                  placeholder="Criterio"
                  value={c.name}
                  onChange={(e) => {
                    const next = [...rubricEditor];
                    next[idx] = { ...c, name: e.target.value };
                    setRubricEditor(next);
                  }}
                />
                <input
                  className="auth-org-input"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Máx"
                  value={c.max_points}
                  onChange={(e) => {
                    const next = [...rubricEditor];
                    next[idx] = { ...c, max_points: e.target.value };
                    setRubricEditor(next);
                  }}
                />
                <input
                  className="auth-org-input"
                  placeholder="Descripción (opcional)"
                  value={c.description}
                  onChange={(e) => {
                    const next = [...rubricEditor];
                    next[idx] = { ...c, description: e.target.value };
                    setRubricEditor(next);
                  }}
                />
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  onClick={() => setRubricEditor(rubricEditor.filter((_, i) => i !== idx))}
                >
                  Quitar
                </button>
              </div>
            ))}
            <div className="pbc-activity-actions pbc-activity-actions--wrap">
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                onClick={() =>
                  setRubricEditor([
                    ...rubricEditor,
                    { name: "", description: "", max_points: "" },
                  ])
                }
              >
                Agregar criterio
              </button>
              <button
                type="button"
                className="auth-btn auth-btn--primary auth-btn--sm"
                disabled={busy || rubricEditor.length === 0}
                onClick={() => void onSaveRubric()}
              >
                Guardar rúbrica
              </button>
            </div>
          </PbcSection>
        ) : null}

        {canTeach ? (
          <PbcSection
            title="Entregas · revisar y corregir"
            description="Solicitar revisión y Evaluar son acciones distintas. Classroom solo sincroniza la nota (no el feedback)."
          >
            {teacherRows.length === 0 ? (
              <PbcEmpty title="Todavía no hay entregas" description="Cuando los alumnos entreguen, aparecerán aquí." />
            ) : (
              <ul className="pbc-list pbc-activity-submissions">
                {teacherRows.map((row) => {
                  const profile = profilesById.get(row.user_id);
                  const draft = gradeDraft[row.id] || {
                    grade: row.grade ?? "",
                    feedback: row.feedback ?? "",
                  };
                  const history = (teacherHistoryByUser.get(row.user_id) || []).filter(
                    (h) => h.id !== row.id,
                  );
                  const verLabel = submissionVersionLabel(row.version);
                  const isFocused = focusStudentId && row.user_id === focusStudentId;
                  const showingCurrent = viewCode === row.id;
                  const process = deriveProcessStatus({
                    status: row.status,
                    version: row.version,
                    hasSubmission: true,
                  });
                  const late =
                    deriveTimeliness({
                      submittedAt: row.submitted_at,
                      dueAt: activity?.due_at,
                    }) === "tarde";
                  const rd = rubricDraftBySubmission[row.id] || {};
                  const canReview = row.status === "submitted" || row.status === "returned";
                  const canEvaluate =
                    row.status === "submitted" ||
                    row.status === "returned" ||
                    row.status === "graded";
                  const canClose = row.status === "graded";
                  const activityWindowClosed =
                    deriveSubmissionWindow({
                      closeAt: activity?.submission_close_at,
                    }) === "cerrada";
                  const canReopen =
                    row.status === "closed" ||
                    row.status === "graded" ||
                    activityWindowClosed;
                  return (
                    <li
                      key={row.id}
                      ref={isFocused ? focusRowRef : undefined}
                      className={`pbc-list-item pbc-activity-submission${isFocused ? " pbc-activity-submission--focus" : ""}`}
                      id={`entrega-${row.user_id}`}
                    >
                      <div className="pbc-activity-submission__head">
                        <div className="pbc-list-item__text">
                          <span className="pbc-list-item__title">
                            {profile?.display_name || profile?.email || row.user_id.slice(0, 8)}
                          </span>
                          <span className="pbc-list-item__meta">
                            {verLabel ? `${verLabel} · ` : ""}
                            {processStatusLabelEs(process)}
                            {late ? " · Tarde" : ""}
                            {row.submitted_at ? ` · ${fmtTs(row.submitted_at)}` : ""}
                            {row.grade != null ? ` · Nota ${row.grade}` : ""}
                            {row.classroom_grade_synced_at
                              ? ` · Nota en Classroom ${fmtTs(row.classroom_grade_synced_at)}`
                              : ""}
                            {row.classroom_grade_sync_error
                              ? ` · Sync pendiente: ${row.classroom_grade_sync_error}`
                              : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          onClick={() => {
                            setViewHistoryId(null);
                            setViewCode(showingCurrent ? null : row.id);
                          }}
                        >
                          {showingCurrent ? "Ocultar código" : "Ver código"}
                        </button>
                      </div>
                      {showingCurrent ? (
                        <SubmissionCodeViewer
                          code={row.submitted_code}
                          ariaLabel={`Código ${verLabel || "actual"} de ${profile?.display_name || "alumno"}`}
                        />
                      ) : null}
                      {history.length > 0 ? (
                        <details className="pbc-activity-history">
                          <summary className="auth-card__muted">
                            Historial ({history.length}{" "}
                            {history.length === 1 ? "versión anterior" : "versiones anteriores"})
                          </summary>
                          <ul className="pbc-activity-history__list">
                            {history.map((h) => {
                              const hLabel = submissionVersionLabel(h.version) || "V?";
                              const showingHist = viewHistoryId === h.id;
                              return (
                                <li key={h.id} className="pbc-activity-history__item">
                                  <div className="pbc-activity-submission__head">
                                    <span className="auth-card__muted">
                                      {hLabel}
                                      {" · "}
                                      {submissionStatusLabelEs(h.status, { version: h.version })}
                                      {h.submitted_at ? ` · ${fmtTs(h.submitted_at)}` : ""}
                                      {h.grade != null ? ` · Nota ${h.grade}` : ""}
                                    </span>
                                    <button
                                      type="button"
                                      className="auth-btn auth-btn--ghost auth-btn--sm"
                                      onClick={() => setViewHistoryId(showingHist ? null : h.id)}
                                    >
                                      {showingHist ? "Ocultar" : "Ver código"}
                                    </button>
                                  </div>
                                  {showingHist ? (
                                    <SubmissionCodeViewer
                                      code={h.submitted_code}
                                      height={220}
                                      ariaLabel={`Código ${hLabel} (historial)`}
                                    />
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : null}
                      {rubricCriteria.length > 0 ? (
                        <div className="pbc-activity-rubric-grade" style={{ marginTop: "0.5rem" }}>
                          {rubricCriteria.map((c) => (
                            <div
                              key={c.id}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 5rem 1fr",
                                gap: "0.35rem",
                                marginBottom: "0.35rem",
                              }}
                            >
                              <span className="auth-card__muted">
                                {c.name} (máx {c.max_points})
                              </span>
                              <input
                                className="auth-org-input"
                                type="number"
                                min="0"
                                max={c.max_points}
                                step="0.5"
                                placeholder="Pts"
                                value={rd[c.id]?.points ?? ""}
                                onChange={(e) =>
                                  setRubricDraftBySubmission((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...rd,
                                      [c.id]: { ...rd[c.id], points: e.target.value },
                                    },
                                  }))
                                }
                              />
                              <input
                                className="auth-org-input"
                                placeholder="Comentario criterio"
                                value={rd[c.id]?.comment ?? ""}
                                onChange={(e) =>
                                  setRubricDraftBySubmission((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...rd,
                                      [c.id]: { ...rd[c.id], comment: e.target.value },
                                    },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="pbc-activity-grade-row">
                        {rubricCriteria.length === 0 ? (
                          <input
                            className="auth-org-input pbc-activity-grade-input"
                            placeholder={
                              activity?.max_points != null
                                ? `Nota / ${activity.max_points}`
                                : "Nota"
                            }
                            value={draft.grade}
                            onChange={(e) =>
                              setGradeDraft((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, grade: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <span className="auth-card__muted" style={{ fontSize: "0.9rem" }}>
                            Nota = suma de rúbrica
                          </span>
                        )}
                        <input
                          className="auth-org-input pbc-activity-feedback-input"
                          placeholder="Feedback general"
                          value={draft.feedback}
                          onChange={(e) =>
                            setGradeDraft((prev) => ({
                              ...prev,
                              [row.id]: { ...draft, feedback: e.target.value },
                            }))
                          }
                        />
                        {canReview ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onRequestReview(row.id)}
                          >
                            Solicitar revisión
                          </button>
                        ) : null}
                        {canEvaluate ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--primary auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onGrade(row.id)}
                          >
                            Evaluar
                          </button>
                        ) : null}
                        {canClose ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onCloseSubmission(row.id)}
                          >
                            Cerrar
                          </button>
                        ) : null}
                        {canReopen ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onReopen(row.user_id)}
                          >
                            Reabrir para este alumno
                          </button>
                        ) : null}
                        {activity?.classroom_coursework_id && row.grade != null ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onSendGradeClassroom(row)}
                          >
                            {row.classroom_grade_sync_error
                              ? "Reintentar sync Classroom"
                              : "Enviar nota a Classroom"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </PbcSection>
        ) : null}

        <div className="pbc-footer-links">
          <Link to={courseHref} className="auth-link">
            ← Volver al curso
          </Link>
          {canTeach && activity?.course_id ? (
            <Link to={entregasHref} className="auth-link">
              Ver entregas del curso
            </Link>
          ) : null}
        </div>
      </PbcPage>
    </PyBotClassShell>
  );
}
