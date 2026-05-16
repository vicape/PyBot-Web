import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DEFAULT_CODE } from "../examplesData.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

export default function CourseActivitiesPage() {
  const { orgId, courseId } = useParams();
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [courseTitle, setCourseTitle] = useState("");
  const [orgName, setOrgName] = useState("");
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [actTitle, setActTitle] = useState("");
  const [starterCode, setStarterCode] = useState(DEFAULT_CODE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !courseId) return;
    setErr("");
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
    if (course.org_id) {
      const { data: org } = await supabase.from("organizations").select("name").eq("id", course.org_id).maybeSingle();
      setOrgName(org?.name ?? "");
    }
    const { data: rows, error: e1 } = await supabase
      .from("activities")
      .select("id,title,created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    if (e1) setErr(e1.message);
    else setActivities(rows ?? []);
    setLoading(false);
  }, [supabase, courseId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate("/login", { replace: true });
    });
    load();
  }, [supabase, load, navigate]);

  const createActivity = async (e) => {
    e.preventDefault();
    const t = actTitle.trim();
    if (!t || saving || !supabase) return;
    setSaving(true);
    setErr("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    const { error } = await supabase.from("activities").insert({
      course_id: courseId,
      title: t,
      starter_code: starterCode,
      created_by: user.id,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setActTitle("");
    setStarterCode(DEFAULT_CODE);
    load();
  };

  const ideUrl = (activityId) => `/?activity=${encodeURIComponent(activityId)}`;

  if (loading) {
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
        <h1 className="auth-card__title">Actividades PyBot</h1>
        <p className="auth-card__muted">
          Cada actividad abre el IDE con código de inicio; el alumno guarda su versión en la nube
          (con sesión Google / Supabase).
        </p>
        {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
        {activities.length === 0 ? (
          <p className="auth-card__muted">Todavía no hay actividades en este curso.</p>
        ) : (
          <ul className="auth-org-list">
            {activities.map((a) => (
              <li key={a.id} className="auth-org-row auth-org-row--split">
                <div>
                  <span className="auth-org-row__name">{a.title}</span>
                  <span className="auth-org-row__meta">ID: {a.id}</span>
                </div>
                <div className="auth-org-row__actions">
                  <a className="auth-btn auth-btn--ghost auth-btn--sm" href={ideUrl(a.id)}>
                    Abrir IDE
                  </a>
                  <button
                    type="button"
                    className="auth-btn auth-btn--ghost auth-btn--sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}${ideUrl(a.id)}`);
                    }}
                  >
                    Copiar enlace
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
          <label className="auth-org-label" htmlFor="act-code">
            Código inicial (Python)
          </label>
          <textarea
            id="act-code"
            className="auth-code-area"
            value={starterCode}
            onChange={(e) => setStarterCode(e.target.value)}
            rows={10}
            spellCheck={false}
            disabled={saving}
          />
          <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
            Crear actividad
          </button>
        </form>
        <p className="auth-card__muted">
          Los alumnos deben iniciar sesión en <Link to="/login">/login</Link> con la misma cuenta
          que en la plataforma para que el guardado automático funcione.
        </p>
        <Link to="/" className="auth-link">
          Ir al IDE
        </Link>
      </div>
    </main>
  );
}
