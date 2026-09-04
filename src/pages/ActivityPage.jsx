import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AssignedContentSnapshotViewer from "../components/content-editor/AssignedContentSnapshotViewer.jsx";
import AssignedLessonViewer from "../components/content-editor/AssignedLessonViewer.jsx";
import {
  hasSavedLessonDocument,
  legacyBlocksToDocument,
  normalizeLessonDocument,
} from "../components/content-editor/legacyLessonDocument.js";
import {
  ACTIVITY_ID_QUERY,
  ACTIVITY_LAUNCH_STATE_KEY,
  resolveActivityEditorCode,
} from "../platform/activityIdeSession.js";
import { writeActivityLaunchCache } from "../platform/courseActivityApi.js";
import { fetchActivityProgress } from "../platform/activityProgress.js";
import {
  fetchActivitySubmissions,
  fetchMySubmission,
  gradeSubmission,
  submissionStatusLabelEs,
  submitActivity,
} from "../platform/activitySubmissions.js";
import {
  fetchCachedClassroomSubmissions,
  publishActivityToClassroom,
  sendGradeToClassroom,
  syncClassroomSubmissionsForActivity,
} from "../platform/activityClassroom.js";
import { fetchAssignedLessonDocument } from "../platform/contentAssignApi.js";
import { listLessonBlocks } from "../platform/contentApi.js";
import { canTeachCourse, fetchMyCourseRole, isCourseStudent } from "../platform/courseRole.js";
import { fetchMyOrgRole } from "../orgRole.js";
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
  const navigate = useNavigate();
  const loginPath = `/actividad/${activityId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [activity, setActivity] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [orgId, setOrgId] = useState(null);
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
  const [profilesById, setProfilesById] = useState(new Map());
  const [viewCode, setViewCode] = useState(null);
  const [gradeDraft, setGradeDraft] = useState({});
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lessonDoc, setLessonDoc] = useState(null);
  const [lessonMeta, setLessonMeta] = useState(null);
  const [lessonErr, setLessonErr] = useState("");
  const [snapshot, setSnapshot] = useState(null);

  const canTeach = canTeachCourse({ orgRole, courseRole });
  const isStudent = isCourseStudent({ courseRole });
  const activityKind = activity?.activity_kind || (activity?.content_snapshot ? "material" : "exercise");
  const isMaterial = activityKind === "material";
  const isCodingActivity = activityKind === "exercise" || activityKind === "task";

  useEffect(() => {
    if (activityId) track("activity_open", { feature: "activity" });
  }, [activityId]);

  const load = useCallback(async () => {
    if (!supabase || !activityId || !user) return;
    setLoadErr("");
    setLoading(true);
    setActionMsg("");
    setActionErr("");

    let { data: act, error: eAct } = await supabase
      .from("activities")
      .select(
        "id, title, description, starter_code, pybot_lesson_id, content_lesson_id, content_snapshot, content_source_type, content_source_id, activity_kind, course_id, due_at, max_points, created_at",
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

    if (act.course_id) {
      const { data: course } = await supabase
        .from("courses")
        .select("title, org_id, classroom_course_id")
        .eq("id", act.course_id)
        .maybeSingle();
      setCourseTitle(course?.title ?? "");
      nextOrgId = course?.org_id ?? null;
      setOrgId(nextOrgId);
      setClassroomCourseId(course?.classroom_course_id ?? null);

      if (nextOrgId) {
        nextOrgRole = await fetchMyOrgRole(supabase, nextOrgId, user.id);
        setOrgRole(nextOrgRole);
      }
      nextCourseRole = await fetchMyCourseRole(supabase, act.course_id, user.id);
      setCourseRole(nextCourseRole);
    }

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
    } else {
      setMySubmission(null);
    }

    if (teach) {
      const list = await fetchActivitySubmissions(activityId);
      setTeacherRows(list.rows ?? []);
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

  const onSendGradeClassroom = async (row) => {
    if (!activity?.classroom_coursework_id || !classroomCourseId || !user || busy) return;
    let classroomSubmissionId = row.classroom_submission_id;

    // 1) activity_submissions · 2) cache por user_id · 3) cache/memoria por classroom_user_id
    if (!classroomSubmissionId) {
      const byUserId = classroomSubs.find((cs) => cs.user_id && cs.user_id === row.user_id);
      if (byUserId?.id) classroomSubmissionId = byUserId.id;
    }
    if (!classroomSubmissionId) {
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
    if (!classroomSubmissionId) {
      setActionErr("No se encontró la entrega Classroom del alumno. Primero «Sincronizar Classroom».");
      return;
    }
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await sendGradeToClassroom({
      submission: row,
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
    setActionMsg("Nota enviada a Classroom.");
    await load();
  };

  const onSubmit = async () => {
    if (!activityId || !user || busy) return;
    if (!window.confirm("¿Entregar esta actividad?")) return;
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const prog = await fetchActivityProgress(activityId, user.id);
    const code = prog.code ?? activity?.starter_code ?? "";
    const r = await submitActivity(activityId, code);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo entregar.");
      return;
    }
    setActionMsg("Actividad entregada.");
    await load();
  };

  const onGrade = async (submissionId) => {
    if (busy) return;
    const draft = gradeDraft[submissionId] || {};
    setBusy(true);
    setActionErr("");
    setActionMsg("");
    const r = await gradeSubmission(submissionId, draft.grade, draft.feedback);
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error || "No se pudo guardar la corrección.");
      return;
    }
    setActionMsg("Corrección guardada.");
    await load();
  };

  if (authLoading || loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando actividad…</p>
      </main>
    );
  }

  if (loadErr) {
    return (
      <main className="auth-root">
        <div className="auth-card auth-card--wide">
          <h1 className="auth-card__title">Actividad</h1>
          <p className="auth-card__notice auth-card__notice--err">{loadErr}</p>
          <Link to="/dashboard" className="auth-btn auth-btn--ghost">
            Volver al panel
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide auth-card--max">
        <p className="auth-breadcrumb">
          <Link to="/dashboard" className="auth-link">
            Panel
          </Link>
          {orgId ? (
            <>
              <span aria-hidden> / </span>
              <Link to={`/dashboard/org/${orgId}`} className="auth-link">
                Colegio
              </Link>
            </>
          ) : null}
          {activity?.course_id ? (
            <>
              <span aria-hidden> / </span>
              <Link to={`/dashboard/org/${orgId}/course/${activity.course_id}`} className="auth-link">
                {courseTitle || "Curso"}
              </Link>
            </>
          ) : null}
        </p>

        <h1 className="auth-card__title">{activity?.title || "Actividad"}</h1>

        {profileError ? (
          <p className="auth-card__notice auth-card__notice--err">{profileError}</p>
        ) : null}
        {actionErr ? <p className="auth-card__notice auth-card__notice--err">{actionErr}</p> : null}
        {actionMsg ? <p className="auth-card__notice">{actionMsg}</p> : null}

        {activity?.description ? (
          <p className="auth-card__lead">{activity.description}</p>
        ) : (
          <p className="auth-card__muted">Sin descripción.</p>
        )}

        {activity?.content_snapshot || activity?.content_lesson_id ? (
          <p className="auth-card__codehint">
            {isMaterial ? "Material de Mi Contenido" : "Actividad desde Mi Contenido"}
            {activity?.content_snapshot?.title ? `: ${activity.content_snapshot.title}` : ""}
            {lessonMeta?.title && !activity?.content_snapshot ? `: ${lessonMeta.title}` : ""}
          </p>
        ) : activity?.pybot_lesson_id ? (
          <p className="auth-card__codehint">
            Lección PyBot (referencia): <code>{activity.pybot_lesson_id}</code>
          </p>
        ) : null}

        {lessonErr ? (
          <p className="auth-card__notice auth-card__notice--err">
            No se pudo cargar el documento de la lección: {lessonErr}
          </p>
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

        {isStudent && mySubmission && isCodingActivity ? (
          <div className="auth-card__muted" style={{ marginBottom: "1rem" }}>
            <p>
              Entrega: <strong>{submissionStatusLabelEs(mySubmission.status)}</strong>
              {mySubmission.submitted_at ? ` · ${fmtTs(mySubmission.submitted_at)}` : null}
            </p>
            {mySubmission.grade != null ? (
              <p>
                Nota: <strong>{mySubmission.grade}</strong>
              </p>
            ) : null}
            {mySubmission.feedback ? <p>Feedback: {mySubmission.feedback}</p> : null}
          </div>
        ) : null}

        <div className="auth-card__actions auth-card__actions--row">
          {isCodingActivity ? (
            <button type="button" className="auth-btn auth-btn--primary" onClick={openPyBot}>
              Abrir PyBot
            </button>
          ) : null}
          {isStudent && isCodingActivity ? (
            <button
              type="button"
              className="auth-btn auth-btn--ghost"
              disabled={busy}
              onClick={() => void onSubmit()}
            >
              {busy ? "Entregando…" : "Entregar actividad"}
            </button>
          ) : null}
          <Link
            to={activity?.course_id ? `/dashboard/classes/${activity.course_id}` : "/dashboard/classes"}
            className="auth-btn auth-btn--ghost"
          >
            Volver al curso
          </Link>
        </div>

        {isCodingActivity ? (
          <p className="auth-card__muted">
            {savedCode
              ? "El autosave guarda progreso; «Entregar» registra la entrega formal."
              : activity?.starter_code
                ? "PyBot abre con el código inicial. Usá «Entregar» cuando termines."
                : "Trabajá en el IDE y entregá cuando estés listo."}
          </p>
        ) : (
          <p className="auth-card__muted">Este material es de solo lectura. No requiere entrega de código.</p>
        )}

        {canTeach && classroomCourseId ? (
          <div className="auth-card__actions auth-card__actions--row" style={{ marginTop: "0.75rem" }}>
            {activity?.classroom_coursework_id ? (
              <>
                <span className="auth-card__muted">Publicada en Classroom</span>
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
                  Sincronizar Classroom
                </button>
                <span className="auth-card__muted" style={{ fontSize: "0.85rem" }}>
                  {classroomSyncedAt
                    ? `Última sincronización: ${fmtTs(classroomSyncedAt)}`
                    : "Sin sincronizar aún"}
                  {classroomSubs.length
                    ? ` · ${classroomSubs.length} StudentSubmission${classroomSubs.length === 1 ? "" : "s"} registrada${classroomSubs.length === 1 ? "" : "s"}`
                    : ""}
                </span>
              </>
            ) : (
              <button
                type="button"
                className="auth-btn auth-btn--ghost"
                disabled={busy}
                onClick={() => void onPublishClassroom()}
              >
                Publicar en Classroom
              </button>
            )}
          </div>
        ) : null}

        {canTeach ? (
          <section style={{ marginTop: "1.5rem" }}>
            <h2 className="auth-section__title">Entregas del curso</h2>
            {teacherRows.length === 0 ? (
              <p className="auth-card__muted">Todavía no hay entregas.</p>
            ) : (
              <ul className="auth-org-list">
                {teacherRows.map((row) => {
                  const profile = profilesById.get(row.user_id);
                  const draft = gradeDraft[row.id] || {
                    grade: row.grade ?? "",
                    feedback: row.feedback ?? "",
                  };
                  return (
                    <li key={row.id} className="auth-org-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div className="auth-org-row--split" style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                        <div>
                          <span className="auth-org-row__name">
                            {profile?.display_name || profile?.email || row.user_id.slice(0, 8)}
                          </span>
                          <span className="auth-org-row__meta">
                            {submissionStatusLabelEs(row.status)}
                            {row.submitted_at ? ` · ${fmtTs(row.submitted_at)}` : ""}
                            {row.grade != null ? ` · Nota ${row.grade}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="auth-btn auth-btn--ghost auth-btn--sm"
                          onClick={() => setViewCode(viewCode === row.id ? null : row.id)}
                        >
                          {viewCode === row.id ? "Ocultar código" : "Ver código"}
                        </button>
                      </div>
                      {viewCode === row.id ? (
                        <pre className="auth-code-area" style={{ whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                          {row.submitted_code || "(vacío)"}
                        </pre>
                      ) : null}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <input
                          className="auth-org-input"
                          style={{ width: "6rem" }}
                          placeholder="Nota"
                          value={draft.grade}
                          onChange={(e) =>
                            setGradeDraft((prev) => ({
                              ...prev,
                              [row.id]: { ...draft, grade: e.target.value },
                            }))
                          }
                        />
                        <input
                          className="auth-org-input"
                          style={{ flex: 1, minWidth: "12rem" }}
                          placeholder="Feedback"
                          value={draft.feedback}
                          onChange={(e) =>
                            setGradeDraft((prev) => ({
                              ...prev,
                              [row.id]: { ...draft, feedback: e.target.value },
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="auth-btn auth-btn--primary auth-btn--sm"
                          disabled={busy}
                          onClick={() => void onGrade(row.id)}
                        >
                          Guardar corrección
                        </button>
                        {activity?.classroom_coursework_id && row.grade != null ? (
                          <button
                            type="button"
                            className="auth-btn auth-btn--ghost auth-btn--sm"
                            disabled={busy}
                            onClick={() => void onSendGradeClassroom(row)}
                          >
                            Enviar nota a Classroom
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
