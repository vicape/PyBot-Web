import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PyBotClassShell from "../components/pybotclass/PyBotClassShell.jsx";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import { isStaffRole } from "../orgRole.js";
import {
  listPybotclassMyCourses,
  listPybotclassOrganizations,
} from "../platform/pybotClassApi.js";
import { slugifyOrganizationName } from "../slugify.js";

export default function PyBotClassPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/classes");
  const [orgs, setOrgs] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");

    const [{ rows: orgRows }, admin] = await Promise.all([
      listPybotclassOrganizations(),
      isSuperAdmin(supabase, user.id),
    ]);
    setSuperAdmin(admin);
    setOrgs(orgRows);
    const orgId = selectedOrgId || (orgRows.length === 1 ? orgRows[0].org_id : "");
    if (!selectedOrgId && orgId) setSelectedOrgId(orgId);

    const { rows, error } = await listPybotclassMyCourses(orgId || null);
    if (error) setErr(error);
    setCourses(rows);
    setLoading(false);
  }, [user, supabase, selectedOrgId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const canCreate = useMemo(() => {
    if (!selectedOrgId) return false;
    const org = orgs.find((o) => o.org_id === selectedOrgId);
    return org?.access_kind === "org_member";
  }, [orgs, selectedOrgId]);

  const createCourse = async (e) => {
    e.preventDefault();
    const title = newCourseTitle.trim();
    if (!title || !supabase || !user || !selectedOrgId || creating) return;
    setCreating(true);
    const { error } = await supabase.from("courses").insert({
      org_id: selectedOrgId,
      title,
      slug: slugifyOrganizationName(title),
      created_by: user.id,
    });
    setCreating(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setNewCourseTitle("");
    await load();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <p className="auth-card__muted">Cargando PyBotClass…</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
      <h1 className="auth-card__title">PyBotClass</h1>
      <p className="auth-card__lead">Mis clases</p>

      {profileError ? <p className="auth-card__notice auth-card__notice--err">{profileError}</p> : null}
      {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}

      {orgs.length >= 2 ? (
        <div style={{ marginBottom: "1rem" }}>
          <label className="auth-org-label" htmlFor="org-select">
            Colegio
          </label>
          <select
            id="org-select"
            className="auth-org-input auth-org-input--block"
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
          >
            <option value="">Todos</option>
            {orgs.map((o) => (
              <option key={o.org_id} value={o.org_id}>
                {o.org_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {courses.length === 0 ? (
        <p className="auth-card__muted">Todavía no tenés clases asignadas.</p>
      ) : (
        <ul className="auth-org-list">
          {courses.map((c) => (
            <li key={c.course_id} className="auth-org-row auth-org-row--split">
              <div>
                <span className="auth-org-row__name">{c.course_title}</span>
                <span className="auth-org-row__meta">
                  {c.student_count ?? 0} alumnos · {c.activity_count ?? 0} actividades
                  {(c.pending_grade_count ?? 0) > 0
                    ? ` · ${c.pending_grade_count} entregas por corregir`
                    : ""}
                  {c.classroom_course_id ? " · Classroom conectado" : ""}
                </span>
                {orgs.length >= 2 || !selectedOrgId ? (
                  <span className="auth-org-row__meta">{c.org_name}</span>
                ) : null}
              </div>
              <Link
                className="auth-btn auth-btn--primary auth-btn--sm"
                to={`/dashboard/classes/${c.course_id}`}
              >
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <form className="auth-activity-form" onSubmit={createCourse} style={{ marginTop: "1.5rem" }}>
          <h2 className="auth-section__title">Crear clase</h2>
          <input
            className="auth-org-input auth-org-input--block"
            placeholder="Nombre de la clase"
            value={newCourseTitle}
            onChange={(e) => setNewCourseTitle(e.target.value)}
            disabled={creating}
          />
          <button type="submit" className="auth-btn auth-btn--primary" disabled={creating}>
            {creating ? "Creando…" : "+ Crear clase"}
          </button>
        </form>
      ) : null}

      <div style={{ marginTop: "1rem" }}>
        <Link to="/dashboard?tab=classroom" className="auth-btn auth-btn--ghost auth-btn--sm">
          Importar desde Classroom
        </Link>
      </div>
    </PyBotClassShell>
  );
}
