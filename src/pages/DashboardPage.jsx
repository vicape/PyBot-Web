import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { getGoogleProfile } from "../authSession.js";
import { signOutGoogleClient } from "../authGoogle.js";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient.js";
import {
  getDashboardNavCapabilities,
  getStaffOrganizations,
  roleLabelEs,
} from "../orgRole.js";
import { fetchProfile } from "../platform/profileApi.js";
import { ensureProfileForUser } from "../platform/ensureProfile.js";
import { fetchMyEnrolledCourses } from "../platform/studentCoursesApi.js";
import { isSuperAdmin } from "../platformRole.js";
import { wasClassroomOAuthIntent } from "../platform/googleOAuth.js";
import { createOrganizationWithOwner } from "../platform/organizationApi.js";
import { COUNTRIES, countryNameByCode } from "../data/countries.js";

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
  const [newOrgCountry, setNewOrgCountry] = useState("AR");
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
  const staffOrgs = useMemo(() => getStaffOrganizations(orgs), [orgs]);
  const nav = useMemo(
    () =>
      getDashboardNavCapabilities({
        orgs,
        enrolledCourseCount: enrolledCourses.length,
      }),
    [orgs, enrolledCourses.length],
  );
  const { showSchoolsTab, showCoursesTab, showClassroomTab } = nav;
  const activeTab = (() => {
    if (!VALID_TABS.has(rawTab)) return "home";
    if (rawTab === "schools" && !showSchoolsTab) return showCoursesTab ? "courses" : "home";
    if (rawTab === "courses" && !showCoursesTab) return showSchoolsTab ? "schools" : "home";
    if (rawTab === "classroom" && !showClassroomTab) return "home";
    return rawTab;
  })();

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
      .select("id, name, slug, created_at, country_code")
      .in("id", orgIds);

    if (eOrg?.message?.includes("country_code")) {
      const fb = await supabase
        .from("organizations")
        .select("id, name, slug, created_at")
        .in("id", orgIds);
      if (fb.error) {
        console.error("loadOrganizations.orgs:", fb.error);
        setOrgError(fb.error.message);
        setOrgs([]);
        setOrgsLoaded(true);
        return;
      }
      const roleByOrg = new Map((memberships ?? []).map((m) => [m.org_id, m.role]));
      const merged = (fb.data ?? []).map((o) => ({
        ...o,
        country_code: null,
        organization_members: [{ role: roleByOrg.get(o.id) }],
      }));
      setOrgs(merged);
      setOrgsLoaded(true);
      return;
    }

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
          navigate("/dashboard/classes?panel=classroom", { replace: true });
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
    if (!useCloud || !sessionUser) return;
    // Home / Cuenta / Classroom viven en PyBotClass
    if (rawTab === "home" || !VALID_TABS.has(rawTab)) {
      navigate("/dashboard/classes", { replace: true });
      return;
    }
    if (rawTab === "account") {
      navigate("/dashboard/classes?panel=account", { replace: true });
      return;
    }
    if (rawTab === "classroom") {
      navigate("/dashboard/classes?panel=classroom", { replace: true });
    }
  }, [useCloud, sessionUser, rawTab, navigate]);

  useEffect(() => {
    if (!orgsLoaded) return;
    if (rawTab === "schools" && !showSchoolsTab) {
      setSearchParams(showCoursesTab ? { tab: "courses" } : {}, { replace: true });
      return;
    }
    if (rawTab === "courses" && !showCoursesTab) {
      setSearchParams(showSchoolsTab ? { tab: "schools" } : {}, { replace: true });
    }
  }, [
    orgsLoaded,
    rawTab,
    showSchoolsTab,
    showCoursesTab,
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

    try {
      const { orgId, error } = await createOrganizationWithOwner({
        name,
        countryCode: newOrgCountry,
      });

      if (error || !orgId) {
        setOrgError(error || "No se pudo crear la institución.");
        return;
      }

      setNewOrgName("");
      await loadOrganizations();
      setTab("schools");
    } catch (ex) {
      console.error("createOrganization:", ex);
      setOrgError(ex?.message || "Error inesperado al crear la institución.");
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

    // Tabs que ya redirigen a PyBotClass: no renderizar shell viejo
    if (activeTab === "home" || activeTab === "account" || activeTab === "classroom") {
      return (
        <main className="dash-root dash-root--center">
          <p className="auth-card__muted">Redirigiendo a PyBotClass…</p>
        </main>
      );
    }

    return (
      <PyBotClassLayout
        user={sessionUser}
        showAdmin={superAdmin}
        hideSearch
        onSignOut={() => void signOutSupabase()}
      >
        <div className="pbc-legacy-panel">
          {profileWarn ? <p className="pbc-alert pbc-alert--info">{profileWarn}</p> : null}

          {activeTab === "courses" && showCoursesTab ? (
            <section className="pbc-panel-card">
              <h2 className="pbc-section-head__title">Mis cursos</h2>
              <p className="pbc-hero-block__subtitle" style={{ marginBottom: "1rem" }}>
                También podés verlos en{" "}
                <Link to="/dashboard/classes">PyBotClass</Link>.
              </p>
              {coursesError ? <p className="pbc-alert pbc-alert--error">{coursesError}</p> : null}
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
            <section className="pbc-panel-card">
              <h2 className="pbc-section-head__title">Instituciones</h2>
              {orgError ? <p className="pbc-alert pbc-alert--error">{orgError}</p> : null}
              {staffOrgs.length === 0 ? (
                <p className="auth-card__muted">Todavía no administrás ninguna institución.</p>
              ) : (
                <ul className="auth-org-list">
                  {staffOrgs.map((o) => (
                    <li key={o.id} className="auth-org-row auth-org-row--link">
                      <Link className="auth-org-row__link" to={`/dashboard/org/${o.id}`}>
                        <span className="auth-org-row__name">{o.name}</span>
                        <span className="auth-org-row__meta">
                          @{o.slug} · {roleLabelEs(o.organization_members?.[0]?.role)}
                          {o.country_code
                            ? ` · ${countryNameByCode(o.country_code) || o.country_code}`
                            : " · País sin definir"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <form className="auth-org-form" onSubmit={createOrganization}>
                <label className="auth-org-label" htmlFor="new-org-name">
                  Crear institución
                </label>
                <div className="auth-org-form__row">
                  <input
                    id="new-org-name"
                    className="auth-org-input"
                    type="text"
                    placeholder="Ej. St. Andrew's Scots School"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    maxLength={120}
                    disabled={savingOrg}
                  />
                  <select
                    className="auth-org-input"
                    value={newOrgCountry}
                    onChange={(e) => setNewOrgCountry(e.target.value)}
                    disabled={savingOrg}
                    aria-label="País"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="auth-btn auth-btn--primary" disabled={savingOrg}>
                    Crear
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>
      </PyBotClassLayout>
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


