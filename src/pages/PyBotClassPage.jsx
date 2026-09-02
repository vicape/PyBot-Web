import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AccountSettings from "../components/dashboard/AccountSettings.jsx";
import ClassroomPanel from "../components/dashboard/ClassroomPanel.jsx";
import AppearanceSettings from "../components/pybotclass/layout/AppearanceSettings.jsx";
import { useAppearanceContext } from "../components/pybotclass/layout/appearanceContext.js";
import CreateCourseModal from "../components/pybotclass/layout/CreateCourseModal.jsx";
import JoinCourseModal from "../components/pybotclass/layout/JoinCourseModal.jsx";
import PyBotClassHome from "../components/pybotclass/layout/PyBotClassHome.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import { fetchOrganizationsForUser } from "../platform/organizationApi.js";
import {
  listPybotclassMyCourses,
  listPybotclassOrganizations,
} from "../platform/pybotClassApi.js";
import { wasClassroomOAuthIntent } from "../platform/googleOAuth.js";

function PyBotClassLoading() {
  return (
    <main className="dash-root dash-root--center">
      <p>Cargando PyBotClass…</p>
    </main>
  );
}

function PyBotClassAccountPanel({ user, onProfileUpdated }) {
  const ctx = useAppearanceContext();

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="pbc-hero-block__title" style={{ marginBottom: "1rem" }}>
        Cuenta
      </h1>
      <AccountSettings user={user} onProfileUpdated={onProfileUpdated} />
      {ctx ? (
        <div style={{ marginTop: "1rem" }}>
          <AppearanceSettings appearance={ctx.appearance} onChange={ctx.updateAppearance} />
        </div>
      ) : null}
    </div>
  );
}

export default function PyBotClassPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = searchParams.get("panel");
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/classes");

  const [orgs, setOrgs] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");

    const [{ rows: orgRows }, admin, memberOrgs] = await Promise.all([
      listPybotclassOrganizations(),
      isSuperAdmin(supabase, user.id),
      fetchOrganizationsForUser(supabase, user.id),
    ]);

    setSuperAdmin(admin);

    const mergedOrgs = orgRows.map((o) => {
      const extra = memberOrgs.find((m) => m.id === o.org_id);
      return {
        ...o,
        country_code: extra?.country_code ?? o.country_code ?? null,
        role: extra?.role ?? o.role,
      };
    });
    for (const m of memberOrgs) {
      if (!mergedOrgs.some((o) => (o.org_id || o.id) === m.id)) {
        mergedOrgs.push({
          org_id: m.id,
          org_name: m.name,
          country_code: m.country_code,
          role: m.role,
          access_kind: "org_member",
        });
      }
    }
    setOrgs(mergedOrgs);

    const { rows, error } = await listPybotclassMyCourses(null);
    if (error) setErr(error);
    setCourses(rows);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  useEffect(() => {
    if (wasClassroomOAuthIntent() && !panel) {
      setSearchParams({ panel: "classroom" }, { replace: true });
    }
  }, [panel, setSearchParams]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.course_title?.toLowerCase().includes(q) || c.org_name?.toLowerCase().includes(q),
    );
  }, [courses, search]);

  if (authLoading || loading) return <PyBotClassLoading />;
  if (!user) return null;

  let content;
  if (panel === "account") {
    content = <PyBotClassAccountPanel user={user} />;
  } else if (panel === "classroom") {
    content = (
      <div style={{ maxWidth: 900 }}>
        <h1 className="pbc-hero-block__title" style={{ marginBottom: "0.5rem" }}>
          Google Classroom
        </h1>
        <p className="pbc-hero-block__subtitle" style={{ marginBottom: "1rem" }}>
          Conectá tu cuenta Google para importar cursos. Usá la misma cuenta con la que ingresaste a
          PyBotClass.
        </p>
        <ClassroomPanel user={user} />
      </div>
    );
  } else {
    content = (
      <PyBotClassHome
        user={user}
        orgs={orgs}
        courses={filteredCourses}
        isSuperAdmin={superAdmin}
        onCreateCourse={() => setShowCreate(true)}
        onJoinCourse={() => setShowJoin(true)}
      />
    );
  }

  return (
    <>
      <PyBotClassLayout
        user={user}
        showAdmin={superAdmin}
        search={search}
        onSearchChange={setSearch}
        onSignOut={() => void signOut()}
      >
        {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
        {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
        {content}
      </PyBotClassLayout>

      <CreateCourseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        supabase={supabase}
        user={user}
        onCreated={load}
      />
      <JoinCourseModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        supabase={supabase}
        onJoined={load}
      />
    </>
  );
}
