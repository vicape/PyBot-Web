import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AccountSettings from "../components/dashboard/AccountSettings.jsx";
import ClassroomPanel from "../components/dashboard/ClassroomPanel.jsx";
import DashboardShell from "../components/dashboard/DashboardShell.jsx";
import { getGoogleProfile } from "../authSession.js";
import { signOutGoogleClient } from "../authGoogle.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import {
  getDashboardNavCapabilities,
  getStaffOrganizations,
  hasTeacherPreference,
  resolveStaffOrgId,
  roleLabelEs,
} from "../orgRole.js";
import { fetchProfile } from "../platform/profileApi.js";
import { ensureProfileForUser } from "../platform/ensureProfile.js";
import { fetchMyEnrolledCourses } from "../platform/studentCoursesApi.js";
import { signupRoleLabelEs } from "../platform/signupRole.js";
import { isSuperAdmin } from "../platformRole.js";
import { wasClassroomOAuthIntent } from "../platform/googleOAuth.js";
import { slugifyOrganizationName } from "../slugify.js";

function LegacyDashboard({ profile, onSignOut }) {
  return (
    <main className="auth-root">
      <div className="auth-card auth-card--wide">
        <h1 className="auth-card__title">Panel</h1>
        <p className="auth-card__lead">Sesión iniciada (solo en este navegador).</p>
        <div className="auth-profile">
          {profile.picture ? (
            <img src={profile.picture} alt="" className="auth-profile__avatar" width={56} height={56} />
          ) : null}
          <div className="auth-profile__text">
            <strong>{profile.name || "Usuario"}</strong>
            {profile.email ? <span className="auth-profile__email">{profile.email}</span> : null}
          </div>
        </div>
        <div className="auth-card__actions auth-card__actions--row">
          <Link to="/" className="auth-btn auth-btn--ghost">
            Abrir IDE
          </Link>
          <button type="button" className="auth-btn auth-btn--primary" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}

const VALID_TABS = new Set(["home", "schools", "courses", "account", "classroom"]);

export default function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const supabase = useMemo(() => getSupabase(), []);
  const useCloud = isSupabaseConfigured();

  const [sessionUser, setSessionUser] = useState(null);
  const [loading, setLoading] = useState(!!useCloud);
  const [orgs, setOrgs] = useState([]);
  const [orgError, setOrgError] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [profileWarn, setProfileWarn] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [preferredRole, setPreferredRole] = useState(null);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [coursesError, setCoursesError] = useState("");
  const [orgsLoaded, setOrgsLoaded] = useState(false);

  const legacyProfile = getGoogleProfile();

  const rawTab = searchParams.get("tab") || "home";
  const teacherPreference = hasTeacherPreference(preferredRole);
  const staffOrgs = useMemo(() => getStaffOrganizations(orgs), [orgs]);
  const nav = useMemo(
    () =>
      getDashboardNavCapabilities({
        orgs,
        enrolledCourseCount: enrolledCourses.length,
      }),
    [orgs, enrolledCourses.length],
  );
  const { hasStaffAccess, hasStudentAccess, showSchoolsTab, showCoursesTab, showClassroomTab, showPyBotClassTab } =
    nav;
  const activeTab = (() => {
    if (!VALID_TABS.has(rawTab)) return "home";
    if (rawTab === "schools" && !showSchoolsTab) return showCoursesTab ? "courses" : "home";
    if (rawTab === "courses" && !showCoursesTab) return showSchoolsTab ? "schools" : "home";
    if (rawTab === "classroom" && !showClassroomTab) return "home";
    return rawTab;
  })();
  const staffOrgId = useMemo(() => resolveStaffOrgId(orgs), [orgs]);

  const setTab = (tabId) => {
    setSearchParams(tabId === "home" ? {} : { tab: tabId }, { replace: true });
  };

  const loadOrganizations = useCallback(async () => {
    if (!supabase || !sessionUser) return;
    setOrgError("");
    setOrgsLoaded(false);

    // 1) Mis membresías (RPC security definer evita recursión RLS)
    let memberships = null;
    const rpc = await supabase.rpc("list_my_org_memberships");
    if (!rpc.error) {
      memberships = rpc.data;
    } else {
      const direct = await supabase
        .from("organization_members")
        .select("org_id, role")
        .eq("user_id", sessionUser.id);
      if (direct.error) {
        console.error("loadOrganizations.memberships:", direct.error);
        setOrgError(direct.error.message);
        setOrgs([]);
        setOrgsLoaded(true);
        return;
      }
      memberships = direct.data;
    }

    const orgIds = (memberships ?? []).map((m) => m.org_id);
    if (orgIds.length === 0) {
      setOrgs([]);
      setOrgsLoaded(true);
      return;
    }

    // 2) Datos de organizaciones
    const { data: orgRows, error: eOrg } = await supabase
      .from("organizations")
      .select("id, name, slug, created_at")
      .in("id", orgIds);

    if (eOrg) {
      console.error("loadOrganizations.orgs:", eOrg);
      setOrgError(eOrg.message);
      setOrgs([]);
      setOrgsLoaded(true);
      return;
    }

    // 3) Merge — formato compatible con el resto del UI (organization_members[0].role)
    const roleByOrg = new Map((memberships ?? []).map((m) => [m.org_id, m.role]));
    const merged = (orgRows ?? []).map((o) => ({
      ...o,
      organization_members: [{ role: roleByOrg.get(o.id) }],
    }));

    setOrgs(merged);
    setOrgsLoaded(true);
  }, [supabase, sessionUser]);

  const loadEnrolledCourses = useCallback(async () => {
    if (!supabase || !sessionUser) return;
    setCoursesError("");
    const { courses, error } = await fetchMyEnrolledCourses(supabase, sessionUser.id);
    if (error) {
      console.error("loadEnrolledCourses:", error);
      setCoursesError(error.message || "No se pudieron cargar tus cursos.");
      setEnrolledCourses([]);
      return;
    }
    setEnrolledCourses(courses);
  }, [supabase, sessionUser]);

  useEffect(() => {
    if (!useCloud) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const applyProfile = async (u) => {
      try {
        const prof = await ensureProfileForUser(u);
        if (!prof.ok && !cancelled) {
          setProfileWarn(prof.error || "No se pudo sincronizar tu perfil.");
        }
        const { profile } = await fetchProfile(u.id);
        if (cancelled) return;
        if (profile?.preferred_role) setPreferredRole(profile.preferred_role);
        setSuperAdmin(isSuperAdmin(profile));
        const meta = u.user_metadata || {};
        setDisplayName(
          profile?.display_name ||
            meta.full_name ||
            meta.name ||
            (u.email ? u.email.split("@")[0] : "Usuario"),
        );
      } catch (ex) {
        console.error("DashboardPage.applyProfile:", ex);
      }
    };

    const timer = setTimeout(finishLoading, 8000);

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        const u = data.session?.user ?? null;
        setSessionUser(u);
        finishLoading();
        if (u) void applyProfile(u);
        if (wasClassroomOAuthIntent() && !cancelled) {
          setSearchParams({ tab: "classroom" }, { replace: true });
        }
      })
      .catch((ex) => {
        console.error("DashboardPage.getSession:", ex);
        finishLoading();
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, sess) => {
      const u = sess?.user ?? null;
      if (event === "INITIAL_SESSION") {
        if (!cancelled) {
          setSessionUser(u);
          finishLoading();
          if (u) void applyProfile(u);
        }
        return;
      }
      setSessionUser(u);
      if (u) {
        void applyProfile(u);
      } else {
        setProfileWarn("");
        setPreferredRole(null);
        setSuperAdmin(false);
        setDisplayName("");
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [useCloud, supabase, setSearchParams]);

  useEffect(() => {
    if (!useCloud || !sessionUser) return;
    loadOrganizations();
  }, [useCloud, sessionUser, loadOrganizations]);

  useEffect(() => {
    if (!useCloud || !sessionUser) return;
    void loadEnrolledCourses();
  }, [useCloud, sessionUser, loadEnrolledCourses]);

  useEffect(() => {
    if (!orgsLoaded) return;
    if (rawTab === "schools" && !showSchoolsTab) {
      setSearchParams(showCoursesTab ? { tab: "courses" } : {}, { replace: true });
      return;
    }
    if (rawTab === "courses" && !showCoursesTab) {
      setSearchParams(showSchoolsTab ? { tab: "schools" } : {}, { replace: true });
      return;
    }
    if (rawTab === "classroom" && !showClassroomTab) {
      setSearchParams({}, { replace: true });
    }
  }, [
    orgsLoaded,
    rawTab,
    showSchoolsTab,
    showCoursesTab,
    showClassroomTab,
    setSearchParams,
  ]);

  const signOutLegacy = () => {
    signOutGoogleClient();
    navigate("/login", { replace: true });
  };

  const signOutSupabase = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut:", error);
    }
    navigate("/login", { replace: true });
  };

  const createOrganization = async (e) => {
    e.preventDefault();
    if (!supabase || !sessionUser || savingOrg) return;
    const name = newOrgName.trim();
    if (!name) return;
    setSavingOrg(true);
    setOrgError("");

    let baseSlug = slugifyOrganizationName(name);
    let slug = baseSlug;

    try {
      // Estrategia 1: RPC atómico (si está definido en DB)
      const rpc = await supabase.rpc("create_organization_with_owner", {
        p_name: name,
        p_slug: baseSlug,
      });

      if (!rpc.error && rpc.data?.org_id) {
        setNewOrgName("");
        await loadOrganizations();
        setTab("schools");
        return;
      }

      // Si el RPC no existe en DB, fallback al flujo en dos pasos
      const rpcMissing =
        rpc.error?.message?.includes("does not exist") ||
        rpc.error?.message?.includes("function") ||
        rpc.error?.code === "42883" ||
        rpc.error?.code === "PGRST202";

      if (!rpcMissing && rpc.error) {
        if (rpc.error.message?.includes("slug_taken") || rpc.error.code === "23505") {
          setOrgError("Ese nombre ya existe. Probá con otro.");
        } else {
          console.error("createOrganization RPC:", rpc.error);
          setOrgError(rpc.error.message || "No se pudo crear el colegio.");
        }
        return;
      }

      // Fallback two-step: insert organization + insert membership owner
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: row, error: insOrg } = await supabase
          .from("organizations")
          .insert({ name, slug, created_by: sessionUser.id })
          .select("id")
          .maybeSingle();

        if (insOrg?.code === "23505") {
          slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
          continue;
        }
        if (insOrg || !row?.id) {
          console.error("createOrganization insOrg:", insOrg);
          setOrgError(insOrg?.message || "No se pudo crear el colegio.");
          return;
        }

        // Insert idempotente: si ya existe (por re-render), upsert lo deja igual
        const { error: insMem } = await supabase
          .from("organization_members")
          .upsert(
            { org_id: row.id, user_id: sessionUser.id, role: "owner" },
            { onConflict: "org_id,user_id", ignoreDuplicates: true },
          );

        if (insMem) {
          console.error("createOrganization insMem:", insMem);
          setOrgError(
            "Colegio creado pero falló la membresía. Avisá al administrador. " + insMem.message,
          );
          return;
        }

        setNewOrgName("");
        await loadOrganizations();
        setTab("schools");
        return;
      }
      setOrgError("No hay slug disponible, probá otro nombre.");
    } catch (ex) {
      console.error("createOrganization:", ex);
      setOrgError(ex?.message || "Error inesperado al crear el colegio.");
    } finally {
      setSavingOrg(false);
    }
  };

  if (useCloud && loading) {
    return (
      <main className="dash-root dash-root--center">
        <p className="auth-card__muted">Cargando panel…</p>
      </main>
    );
  }

  if (useCloud && !sessionUser) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Panel</h1>
          <p className="auth-card__lead">Iniciá sesión para ver tus colegios.</p>
          <div className="auth-card__actions">
            <Link to="/login" className="auth-btn auth-btn--ghost">
              Ir a login
            </Link>
            <Link to="/" className="auth-link">
              Abrir IDE
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (useCloud && sessionUser) {
    const meta = sessionUser.user_metadata || {};
    const email = sessionUser.email;
    const picture = meta.avatar_url || meta.picture || null;
    const name = displayName || email?.split("@")[0] || "Usuario";

    return (
      <DashboardShell
        activeTab={activeTab}
        onTabChange={setTab}
        showSchoolsTab={showSchoolsTab}
        showCoursesTab={showCoursesTab}
        showClassroomTab={showClassroomTab}
        showPyBotClassTab={showPyBotClassTab}
        showAdminTab={superAdmin}
        userName={name}
        userEmail={email}
        userPicture={picture}
        onSignOut={() => void signOutSupabase()}
      >
        {activeTab === "home" ? (
          <div className="dash-grid">
            <section className="dash-panel dash-panel--highlight">
              <h2 className="dash-panel__title">Bienvenido, {name}</h2>
              <p className="auth-card__muted auth-card__muted--tight">
                {hasStaffAccess && hasStudentAccess
                  ? "Administrá colegios y también accedé a tus cursos como alumno. El IDE en "
                  : hasStaffAccess
                    ? "Gestioná colegios, cursos y actividades PyBot. El IDE en "
                    : "Accedé a las actividades de tus cursos. El IDE en "}
                <Link to="/">la página principal</Link> sigue libre y sin cuenta.
              </p>
              {profileWarn ? <p className="auth-card__notice">{profileWarn}</p> : null}
              {teacherPreference && !hasStaffAccess ? (
                <p className="auth-card__notice">
                  Creá o unite a un colegio como docente para usar Classroom.
                </p>
              ) : null}
              {preferredRole === "student" && orgs.length === 0 ? (
                <p className="auth-card__notice">
                  ¿Tenés código de invitación de tu colegio?{" "}
                  <Link to="/join">Unite acá</Link>.
                </p>
              ) : null}
              <div className="dash-stat-row">
                {hasStaffAccess ? (
                  <div className="dash-stat">
                    <span className="dash-stat__value">{staffOrgs.length}</span>
                    <span className="dash-stat__label">Colegios</span>
                  </div>
                ) : null}
                {hasStudentAccess ? (
                  <div className="dash-stat">
                    <span className="dash-stat__value">{enrolledCourses.length}</span>
                    <span className="dash-stat__label">Cursos</span>
                  </div>
                ) : null}
                <div className="dash-stat">
                  <span className="dash-stat__value">
                    {hasStaffAccess && hasStudentAccess
                      ? "Docente + alumno"
                      : hasStaffAccess
                        ? "Docente (colegio)"
                        : signupRoleLabelEs(preferredRole) || "Alumno"}
                  </span>
                  <span className="dash-stat__label">Perfil</span>
                </div>
              </div>
              {teacherPreference && !hasStaffAccess ? (
                <form className="auth-org-form" onSubmit={createOrganization}>
                  <label className="auth-org-label" htmlFor="new-org-home">
                    Crear colegio
                  </label>
                  <div className="auth-org-form__row">
                    <input
                      id="new-org-home"
                      className="auth-org-input"
                      type="text"
                      placeholder="Ej. Escuela San Martín"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      maxLength={120}
                      disabled={savingOrg}
                    />
                    <button type="submit" className="auth-btn auth-btn--primary" disabled={savingOrg}>
                      Crear
                    </button>
                  </div>
                </form>
              ) : null}
              <div className="auth-org-row__actions">
                {showPyBotClassTab ? (
                  <Link to="/dashboard/classes" className="auth-btn auth-btn--primary">
                    PyBotClass
                  </Link>
                ) : null}
                {showSchoolsTab ? (
                  <button type="button" className="auth-btn auth-btn--primary" onClick={() => setTab("schools")}>
                    Ver colegios
                  </button>
                ) : null}
                {showCoursesTab ? (
                  <button
                    type="button"
                    className={`auth-btn ${showSchoolsTab ? "auth-btn--ghost" : "auth-btn--primary"}`}
                    onClick={() => setTab("courses")}
                  >
                    Mis cursos
                  </button>
                ) : null}
                <button type="button" className="auth-btn auth-btn--ghost" onClick={() => setTab("account")}>
                  Configurar cuenta
                </button>
                {showClassroomTab ? (
                  <button type="button" className="auth-btn auth-btn--ghost" onClick={() => setTab("classroom")}>
                    Google Classroom
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "courses" && showCoursesTab ? (
          <section className="dash-panel">
            <h2 className="dash-panel__title">Mis cursos</h2>
            {coursesError ? <p className="auth-card__notice auth-card__notice--err">{coursesError}</p> : null}
            {enrolledCourses.length === 0 ? (
              <p className="auth-card__muted">
                Todavía no estás inscripto en ningún curso. Si tu docente te dio un código,{" "}
                <Link to="/join">unite acá</Link>.
              </p>
            ) : (
              <ul className="auth-org-list">
                {enrolledCourses.map((c) => (
                  <li key={c.id} className="auth-org-row auth-org-row--link">
                    <Link
                      className="auth-org-row__link"
                      to={`/dashboard/org/${c.org_id}/course/${c.id}`}
                    >
                      <span className="auth-org-row__name">{c.title}</span>
                      <span className="auth-org-row__meta">
                        {c.orgName ? `${c.orgName} · ` : ""}
                        {c.slug ? `@${c.slug}` : "Actividades"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {activeTab === "schools" && showSchoolsTab ? (
          <section className="dash-panel">
            <h2 className="dash-panel__title">Tus colegios</h2>
            {orgError ? <p className="auth-card__notice auth-card__notice--err">{orgError}</p> : null}
            {staffOrgs.length === 0 ? (
              <p className="auth-card__muted">Todavía no administrás ningún colegio.</p>
            ) : (
              <ul className="auth-org-list">
                {staffOrgs.map((o) => (
                  <li key={o.id} className="auth-org-row auth-org-row--link">
                    <Link className="auth-org-row__link" to={`/dashboard/org/${o.id}`}>
                      <span className="auth-org-row__name">{o.name}</span>
                      <span className="auth-org-row__meta">
                        @{o.slug} · {roleLabelEs(o.organization_members?.[0]?.role)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <form className="auth-org-form" onSubmit={createOrganization}>
              <label className="auth-org-label" htmlFor="new-org-name">
                Crear colegio
              </label>
              <div className="auth-org-form__row">
                <input
                  id="new-org-name"
                  className="auth-org-input"
                  type="text"
                  placeholder="Ej. Escuela San Martín"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  maxLength={120}
                  disabled={savingOrg}
                />
                <button type="submit" className="auth-btn auth-btn--primary" disabled={savingOrg}>
                  Crear
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === "account" ? (
          <AccountSettings user={sessionUser} onProfileUpdated={setDisplayName} />
        ) : null}

        {activeTab === "classroom" && hasStaffAccess ? (
          <ClassroomPanel user={sessionUser} staffOrgId={staffOrgId} staffOrgs={staffOrgs} />
        ) : null}
      </DashboardShell>
    );
  }

  if (!legacyProfile) {
    return (
      <main className="auth-root">
        <div className="auth-card">
          <h1 className="auth-card__title">Panel</h1>
          <p className="auth-card__lead">No hay sesión iniciada en este navegador.</p>
          <div className="auth-card__actions">
            <Link to="/login" className="auth-btn auth-btn--ghost">
              Ir a login
            </Link>
            <Link to="/" className="auth-link">
              Abrir IDE
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <LegacyDashboard profile={legacyProfile} onSignOut={signOutLegacy} />;
}


