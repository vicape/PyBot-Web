import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ACTIVITY_ID_QUERY,
  ACTIVITY_LAUNCH_STATE_KEY,
  resolveActivityEditorCode,
} from "../platform/activityIdeSession.js";
import { writeActivityLaunchCache } from "../platform/courseActivityApi.js";
import { fetchActivityProgress } from "../platform/activityProgress.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { getSupabase } from "../supabaseClient.js";
import { track } from "../telemetry/index.js";

export default function ActivityPage() {
  const { activityId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/actividad/${activityId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [activity, setActivity] = useState(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [orgId, setOrgId] = useState(null);
  const [progressHint, setProgressHint] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activityId) track("activity_open", { feature: "activity" });
  }, [activityId]);

  const load = useCallback(async () => {
    if (!supabase || !activityId || !user) return;
    setLoadErr("");
    setLoading(true);

    let { data: act, error: eAct } = await supabase
      .from("activities")
      .select("id, title, description, starter_code, pybot_lesson_id, course_id, created_at")
      .eq("id", activityId)
      .maybeSingle();

    if (eAct) {
      console.error("ActivityPage.load (full):", eAct);
      const fb = await supabase
        .from("activities")
        .select("id, title, description, pybot_lesson_id, course_id, created_at")
        .eq("id", activityId)
        .maybeSingle();
      act = fb.data;
      eAct = fb.error;
    }

    if (eAct) {
      console.error("ActivityPage.load (fallback):", eAct);
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

    if (act.course_id) {
      const { data: course } = await supabase
        .from("courses")
        .select("title, org_id")
        .eq("id", act.course_id)
        .maybeSingle();
      setCourseTitle(course?.title ?? "");
      setOrgId(course?.org_id ?? null);
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
      setProgressHint("Todavía no hay entrega guardada en la nube.");
    }

    writeActivityLaunchCache(activityId, launchCode);

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

        {activity?.description ? (
          <p className="auth-card__lead">{activity.description}</p>
        ) : (
          <p className="auth-card__muted">Sin descripción.</p>
        )}

        {activity?.pybot_lesson_id ? (
          <p className="auth-card__codehint">
            Lección PyBot (referencia): <code>{activity.pybot_lesson_id}</code>
          </p>
        ) : null}

        <p className="auth-card__muted">{progressHint}</p>

        <div className="auth-card__actions auth-card__actions--row">
          <button type="button" className="auth-btn auth-btn--primary" onClick={openPyBot}>
            Abrir PyBot
          </button>
          <Link to="/dashboard" className="auth-btn auth-btn--ghost">
            Panel
          </Link>
        </div>

        <p className="auth-card__muted">
          {savedCode
            ? "PyBot abre con tu último código guardado. Los cambios se sincronizan automáticamente en la nube."
            : activity?.starter_code
              ? "PyBot abre con el código inicial de la tarea. Los cambios se guardan automáticamente en la nube."
              : "PyBot abre el editor en blanco para esta actividad. Los cambios se guardan automáticamente en la nube."}
        </p>
      </div>
    </main>
  );
}
