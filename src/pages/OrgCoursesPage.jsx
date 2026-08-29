import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { slugifyOrganizationName } from "../slugify.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import DashboardSubpageShell from "../components/dashboard/DashboardSubpageShell.jsx";

export default function OrgCoursesPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/org/${orgId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [orgName, setOrgName] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [courseName, setCourseName] = useState("");
  const [saving, setSaving] = useState(false);
  const [myRole, setMyRole] = useState(null);

  const staff = isStaffRole(myRole);

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut:", error);
    }
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const shell = (body) => (
    <DashboardSubpageShell user={user} myRole={myRole} onSignOut={() => void signOut()}>
      {body}
    </DashboardSubpageShell>
  );

  const load = useCallback(async () => {
    if (!supabase || !orgId || !user) return;
    setErr("");
    setLoading(true);

    try {
      const r = await fetchMyOrgRole(supabase, orgId, user.id);
      setMyRole(r);
    } catch {
      setMyRole(null);
    }

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
      .select("id,title,slug,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (e1) {
      console.error("loadCourses (with slug):", e1);
      const fallback = await supabase
        .from("courses")
        .select("id,title,created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (fallback.error) {
        console.error("loadCourses fallback:", fallback.error);
        setErr(fallback.error.message);
      } else {
        setCourses(fallback.data ?? []);
      }
    } else {
      setCourses(rows ?? []);
    }

    setLoading(false);
  }, [supabase, orgId, user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const createCourse = async (e) => {
    e.preventDefault();
    const name = courseName.trim();
    if (!name || saving || !supabase || !user || !staff) return;

    setSaving(true);
    setErr("");

    const slug = slugifyOrganizationName(name);
    const payload = {
      org_id: orgId,
      title: name,
      slug,
      created_by: user.id,
    };

    let { error } = await supabase.from("courses").insert(payload);

    if (error?.message?.includes("slug")) {
      ({ error } = await supabase.from("courses").insert({
        org_id: orgId,
        title: name,
        created_by: user.id,
      }));
    }

    setSaving(false);
    if (error) {
      console.error("createCourse:", error);
      setErr(error.message);
      return;
    }
    setCourseName("");
    await load();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p className="auth-card__muted">Cargando cursos…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return shell(
    <>
        <p className="auth-breadcrumb">
          <Link to="/dashboard" className="auth-link">
            Inicio
          </Link>
          <span aria-hidden> / </span>
          <Link to="/dashboard?tab=schools" className="auth-link">
            Colegios
          </Link>
          <span aria-hidden> / </span>
          <span>{orgName || "Colegio"}</span>
        </p>

        <h1 className="auth-card__title">
          Cursos
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

        {courses.length === 0 ? (
          <p className="auth-card__muted">
            {staff ? "No hay cursos todavía. Creá uno abajo." : "Todavía no hay cursos publicados."}
          </p>
        ) : (
          <ul className="auth-org-list">
            {courses.map((c) => (
              <li key={c.id} className="auth-org-row auth-org-row--link">
                <Link className="auth-org-row__link" to={`/dashboard/org/${orgId}/course/${c.id}`}>
                  <span className="auth-org-row__name">{c.title}</span>
                  <span className="auth-org-row__meta">
                    {c.slug ? `@${c.slug}` : "Actividades"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {staff ? (
          <form className="auth-org-form" onSubmit={createCourse}>
            <label className="auth-org-label" htmlFor="course-title">
              Nuevo curso
            </label>
            <div className="auth-org-form__row">
              <input
                id="course-title"
                className="auth-org-input"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="Ej. Robótica 1A"
                maxLength={160}
                disabled={saving}
              />
              <button type="submit" className="auth-btn auth-btn--primary" disabled={saving}>
                Crear
              </button>
            </div>
          </form>
        ) : (
          <p className="auth-card__muted">Solo docentes y gestión pueden crear cursos.</p>
        )}

        {staff ? (
          <p className="auth-card__muted auth-card__muted--tight">
            <Link to="/dashboard?tab=classroom">Conectar Google Classroom</Link> desde el panel para importar
            cursos.
          </p>
        ) : null}
        <Link to="/" className="auth-link">
          IDE anónimo
        </Link>
    </>,
  );
}
