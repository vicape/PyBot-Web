import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

export default function CourseActivitiesPage() {
  const { orgId, courseId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/org/${orgId}/course/${courseId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [courseTitle, setCourseTitle] = useState("");
  const [orgName, setOrgName] = useState("");
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [actTitle, setActTitle] = useState("");
  const [actDescription, setActDescription] = useState("");
  const [pybotLessonId, setPybotLessonId] = useState("");
  const [saving, setSaving] = useState(false);
  const [myRole, setMyRole] = useState(null);

  const staff = isStaffRole(myRole);
  const activityUrl = (id) => `/actividad/${encodeURIComponent(id)}`;

  const load = useCallback(async () => {
    if (!supabase || !courseId || !user) return;
    setErr("");
    setLoading(true);

    const { data: course, error: e0 } = await supabase
      .from("courses")
      .select("title, org_id")
      .eq("id", courseId)
      .maybeSingle();

    if (e0 || !course) {
      setErr(e0?.message || "Curso no encontrado.");
      setLoading(false);
      return;
    }

    setCourseTitle(course.title ?? "");

    try {
      const r = await fetchMyOrgRole(supabase, course.org_id, user.id);
      setMyRole(r);
    } catch {
      setMyRole(null);
    }

    if (course.org_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", course.org_id)
        .maybeSingle();
      setOrgName(org?.name ?? "");
    }

    let { data: rows, error: e1 } = await supabase
      .from("activities")
      .select("id,title,description,pybot_lesson_id,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });

    if (e1) {
      const fb = await supabase
        .from("activities")
        .select("id,title,created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false });
      if (fb.error) setErr(fb.error.message);
      else setActivities(fb.data ?? []);
    } else {
      setActivities(rows ?? []);
    }

    setLoading(false);
  }, [supabase, courseId, user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const createActivity = async (e) => {
    e.preventDefault();
    const t = actTitle.trim();
    if (!t || saving || !supabase || !staff || !user) return;

    setSaving(true);
    setErr("");

    const base = {
      course_id: courseId,
      title: t,
      created_by: user.id,
    };

    const full = {
      ...base,
      description: actDescription.trim(),
      pybot_lesson_id: pybotLessonId.trim() || null,
      starter_code: "",
    };

    let { error } = await supabase.from("activities").insert(full);

    if (error?.message?.includes("description") || error?.message?.includes("pybot_lesson")) {
      ({ error } = await supabase.from("activities").insert({
        ...base,
        starter_code: actDescription.trim() || "",
      }));
    }

    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }

    setActTitle("");
    setActDescription("");
    setPybotLessonId("");
    await load();
  };

  if (authLoading || loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando actividades…</p>
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
          <span aria-hidden> / </span>
          <Link to={`/dashboard/org/${orgId}`} className="auth-link">
            {orgName || "Colegio"}
          </Link>
          <span aria-hidden> / </span>
          <span>{courseTitle || "Curso"}</span>
        </p>

        <h1 className="auth-card__title">
          Actividades
          <span
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 500,
              opacity: 0.75,
              marginTop: "0.25rem",
            }}
          >
            Tu rol: {roleLabelEs(myRole)}
          </span>
        </h1>

        {profileError ? <p className="auth-card__notice auth-card__notice--err">{profileError}</p> : null}
        {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}

        {activities.length === 0 ? (
          <p className="auth-card__muted">Todavía no hay actividades en este curso.</p>
        ) : (
          <ul className="auth-org-list">
            {activities.map((a) => (
              <li key={a.id} className="auth-org-row auth-org-row--split">
                <div>
                  <span className="auth-org-row__name">{a.title}</span>
                  <span className="auth-org-row__meta">
                    {a.description ? a.description.slice(0, 80) : "Ver actividad"}
                  </span>
                </div>
                <div className="auth-org-row__actions">
                  <Link className="auth-btn auth-btn--ghost auth-btn--sm" to={activityUrl(a.id)}>
                    Ver actividad
                  </Link>
                  <button
                    type="button"
                    className="auth-btn auth-btn--ghost auth-btn--sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        `${window.location.origin}${activityUrl(a.id)}`,
                      );
                    }}
                  >
                    Copiar enlace
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {staff ? (
          <form className="auth-activity-form" onSubmit={createActivity}>
            <h2 className="auth-section__title">Nueva actividad</h2>
            <label className="auth-org-label" htmlFor="act-title">
              Título
            </label>
            <input
              id="act-title"
              className="auth-org-input auth-org-input--block"
              value={actTitle}
              onChange={(e) => setActTitle(e.target.value)}
              placeholder="Ej. Semáforo con wait"
              maxLength={160}
              disabled={saving}
            />
            <label className="auth-org-label" htmlFor="act-desc">
              Descripción
            </label>
            <textarea
              id="act-desc"
              className="auth-code-area"
              rows={4}
              value={actDescription}
              onChange={(e) => setActDescription(e.target.value)}
              placeholder="Instrucciones para el alumno"
              disabled={saving}
            />
            <label className="auth-org-label" htmlFor="act-lesson">
              ID lección PyBot (opcional)
            </label>
            <input
              id="act-lesson"
              className="auth-org-input auth-org-input--block"
              value={pybotLessonId}
              onChange={(e) => setPybotLessonId(e.target.value)}
              placeholder="Ej. modulo-1-leccion-3"
              maxLength={120}
              disabled={saving}
            />
            <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
              Crear actividad
            </button>
          </form>
        ) : (
          <p className="auth-card__muted">Tu docente publica las actividades nuevas.</p>
        )}

        <Link to="/" className="auth-link">
          Ir al IDE (anónimo)
        </Link>
      </div>
    </main>
  );
}
