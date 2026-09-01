import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PyBotClassShell from "../components/pybotclass/PyBotClassShell.jsx";
import {
  PbcAlert,
  PbcClassCard,
  PbcClassGrid,
  PbcEmpty,
  PbcHero,
  PbcLoading,
  PbcPage,
  PbcSection,
  PbcSelect,
  PbcToolbar,
} from "../components/pybotclass/PyBotClassUi.jsx";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
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
  const [showCreate, setShowCreate] = useState(false);

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

  const showOrgOnCards = orgs.length >= 2 || !selectedOrgId;
  const pendingTotal = courses.reduce((n, c) => n + (c.pending_grade_count ?? 0), 0);

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
    setShowCreate(false);
    await load();
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <PbcLoading label="Cargando PyBotClass…" />
      </main>
    );
  }

  if (!user) return null;

  return (
    <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
      <PbcPage>
        <PbcHero
          eyebrow="Gestión escolar"
          title="PyBotClass"
          subtitle="Tus clases, actividades, entregas y notas en un solo lugar."
          actions={
            <>
              {canCreate ? (
                <button
                  type="button"
                  className="auth-btn auth-btn--primary auth-btn--sm"
                  onClick={() => setShowCreate((v) => !v)}
                >
                  {showCreate ? "Cancelar" : "+ Nueva clase"}
                </button>
              ) : null}
              <Link to="/dashboard?tab=classroom" className="auth-btn auth-btn--ghost auth-btn--sm">
                Importar Classroom
              </Link>
            </>
          }
        />

        {profileError ? <PbcAlert variant="error">{profileError}</PbcAlert> : null}
        {err ? <PbcAlert variant="error">{err}</PbcAlert> : null}

        <PbcToolbar>
          <div className="pbc-toolbar__left">
            <span className="pbc-field__label">
              {courses.length} clase{courses.length === 1 ? "" : "s"}
              {pendingTotal > 0 ? ` · ${pendingTotal} por corregir` : ""}
            </span>
          </div>
          {orgs.length >= 2 ? (
            <PbcSelect
              id="org-select"
              label="Colegio"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
            >
              <option value="">Todos los colegios</option>
              {orgs.map((o) => (
                <option key={o.org_id} value={o.org_id}>
                  {o.org_name}
                </option>
              ))}
            </PbcSelect>
          ) : orgs.length === 1 ? (
            <span className="pbc-pill pbc-pill--muted">{orgs[0].org_name}</span>
          ) : null}
        </PbcToolbar>

        {showCreate && canCreate ? (
          <PbcSection title="Crear clase">
            <form className="dash-form" onSubmit={createCourse}>
              <input
                className="auth-org-input auth-org-input--block"
                placeholder="Ej. Python 8A"
                value={newCourseTitle}
                onChange={(e) => setNewCourseTitle(e.target.value)}
                disabled={creating}
                autoFocus
              />
              <div className="auth-card__actions auth-card__actions--row">
                <button type="submit" className="auth-btn auth-btn--primary" disabled={creating}>
                  {creating ? "Creando…" : "Crear clase"}
                </button>
              </div>
            </form>
          </PbcSection>
        ) : null}

        {courses.length === 0 ? (
          <PbcEmpty
            title="Sin clases todavía"
            description="Cuando te asignen una clase o importes un curso desde Classroom, va a aparecer acá."
            action={
              <Link to="/dashboard?tab=classroom" className="auth-btn auth-btn--primary auth-btn--sm">
                Importar desde Classroom
              </Link>
            }
          />
        ) : (
          <PbcClassGrid>
            {courses.map((c) => (
              <PbcClassCard key={c.course_id} course={c} showOrg={showOrgOnCards} />
            ))}
          </PbcClassGrid>
        )}
      </PbcPage>
    </PyBotClassShell>
  );
}
