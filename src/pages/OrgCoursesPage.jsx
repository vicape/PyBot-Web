import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";

export default function OrgCoursesPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const supabase = useMemo(() => getSupabase(), []);
  const [orgName, setOrgName] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !orgId) return;
    setErr("");
    const { data: org, error: e0 } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (e0 || !org) {
      setErr(e0?.message || "Colegio no encontrado o sin permiso.");
      setLoading(false);
      return;
    }
    setOrgName(org.name ?? "");
    const { data: rows, error: e1 } = await supabase
      .from("courses")
      .select("id,title,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (e1) setErr(e1.message);
    else setCourses(rows ?? []);
    setLoading(false);
  }, [supabase, orgId]);

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

  const createCourse = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving || !supabase) return;
    setSaving(true);
    setErr("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    const { error } = await supabase.from("courses").insert({
      org_id: orgId,
      title: t,
      created_by: user.id,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    load();
  };

  if (loading) {
    return (
      <main className="auth-root">
        <p className="auth-card__muted">Cargando cursos…</p>
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
          <span>{orgName || "Colegio"}</span>
        </p>
        <h1 className="auth-card__title">Cursos</h1>
        <p className="auth-card__muted">
          Creá un curso por materia o grupo; dentro definís las actividades PyBot.
        </p>
        {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
        {courses.length === 0 ? (
          <p className="auth-card__muted">No hay cursos todavía. Creá uno abajo.</p>
        ) : (
          <ul className="auth-org-list">
            {courses.map((c) => (
              <li key={c.id} className="auth-org-row auth-org-row--link">
                <Link className="auth-org-row__link" to={`/dashboard/org/${orgId}/course/${c.id}`}>
                  <span className="auth-org-row__name">{c.title}</span>
                  <span className="auth-org-row__meta">Actividades</span>
                </Link>
              </li>
            ))}
          </ul>
        )}        <form className="auth-org-form" onSubmit={createCourse}>
          <label className="auth-org-label" htmlFor="course-title">
            Nuevo curso
          </label>
          <div className="auth-org-form__row">
            <input
              id="course-title"
              className="auth-org-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Robótica 1A"
              maxLength={160}
              disabled={saving}
            />
            <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
              Crear
            </button>
          </div>
        </form>
        <Link to="/" className="auth-link">
          Ir al IDE
        </Link>
      </div>
    </main>
  );
}
