import { t } from "../i18n.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PyBotClassShell, { CourseTabs, PyBotClassBreadcrumb } from "../components/pybotclass/PyBotClassShell.jsx";
import {
  PbcAlert,
  PbcCourseHeader,
  PbcEmpty,
  PbcFormPanel,
  PbcLoading,
  PbcPage,
} from "../components/pybotclass/PyBotClassUi.jsx";
import CourseSummaryTab from "../components/pybotclass/CourseSummaryTab.jsx";
import CourseActivitiesTab from "../components/pybotclass/CourseActivitiesTab.jsx";
import CourseRosterTab from "../components/pybotclass/CourseRosterTab.jsx";
import CourseSubmissionsTab from "../components/pybotclass/CourseSubmissionsTab.jsx";
import CourseGradesTab from "../components/pybotclass/CourseGradesTab.jsx";
import CourseIntegrationsTab from "../components/pybotclass/CourseIntegrationsTab.jsx";
import { fetchMyOrgRole } from "../orgRole.js";
import {
  COURSE_ACCESS_MODES,
  courseTabIdsForMode,
  fetchMyCourseRole,
  formatCurrentRoleCompact,
  formatCurrentRoleLabel,
  resolveCourseContext,
} from "../platform/courseRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { fetchProfile } from "../platform/profileApi.js";
import { isSuperAdmin } from "../platformRole.js";
import {
  fetchCourseActivities,
  fetchCourseBasics,
  importClassroomActivities,
} from "../platform/pybotClassApi.js";
import { listCourseWork } from "../classroom/classroomApi.js";
import { getValidClassroomToken } from "../platform/classroomToken.js";

const TAB_LABELS = {
  resumen: () => t("pcTabSummary"),
  actividades: () => t("pcTabActivities"),
  alumnos: () => t("pcTabStudents"),
  entregas: () => t("pcTabSubmissions"),
  notas: () => t("pcTabGrades"),
  integraciones: () => t("pcTabIntegrations"),
};

function tabsForMode(mode) {
  return courseTabIdsForMode(mode).map((id) => ({
    id,
    label: TAB_LABELS[id]?.() || id,
  }));
}

export default function PyBotClassCoursePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const loginPath = `/dashboard/classes/${courseId}`;
  const { user, loading: authLoading, profileError, supabase } = useRequireSession(loginPath);

  const [course, setCourse] = useState(null);
  const [activities, setActivities] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [courseRole, setCourseRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importPicker, setImportPicker] = useState(null);

  const context = useMemo(
    () =>
      resolveCourseContext({
        orgRole: myRole,
        courseRole,
        isSuperAdmin: superAdmin,
      }),
    [myRole, courseRole, superAdmin],
  );

  const { mode, displayRole, capabilities } = context;
  const canTeach = capabilities.canTeachCourse && mode === COURSE_ACCESS_MODES.TEACHING;
  const contextualRoleLabel = formatCurrentRoleLabel(displayRole, t);
  const contextualRoleCompact = formatCurrentRoleCompact(displayRole, t);

  const tabs = tabsForMode(mode);
  const rawTab = searchParams.get("tab") || "resumen";
  const activeTab = tabs.some((tab) => tab.id === rawTab) ? rawTab : "resumen";
  const setTab = (tabId, extra = {}) => {
    const next = {};
    if (tabId !== "resumen") next.tab = tabId;
    Object.assign(next, extra);
    setSearchParams(next, { replace: true });
  };

  const goCreateActivity = () => setTab("actividades", { action: "create" });
  const goAddStudents = () => setTab("alumnos", { focus: "invite" });
  const goAssignContent = () => {
    navigate(`/dashboard/content?assignToCourse=${encodeURIComponent(courseId)}`);
  };
  const goSubmissions = () => setTab("entregas");
  const goIntegrations = () => setTab("integraciones");

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!supabase || !courseId || !user) return;
    setLoading(true);
    setErr("");

    const [{ course: c, error: cErr }, { profile }] = await Promise.all([
      fetchCourseBasics(courseId),
      fetchProfile(user.id),
    ]);
    setSuperAdmin(isSuperAdmin(profile));

    if (cErr || !c) {
      setErr(cErr || t("pcCourseNotFound"));
      setLoading(false);
      return;
    }
    setCourse(c);

    try {
      setMyRole(await fetchMyOrgRole(supabase, c.org_id, user.id));
    } catch {
      setMyRole(null);
    }
    try {
      setCourseRole(await fetchMyCourseRole(supabase, courseId, user.id));
    } catch {
      setCourseRole(null);
    }

    const { rows } = await fetchCourseActivities(courseId);
    setActivities(rows);
    setLoading(false);
  }, [supabase, courseId, user]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const importFromClassroom = async () => {
    if (!course?.classroom_course_id) {
      setErr(t("pcClassroomNotLinkedCourse"));
      return;
    }
    setImportBusy(true);
    setErr("");
    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) throw new Error(t("pcClassroomNotConnected"));
      const list = await listCourseWork(tok, course.classroom_course_id);
      setImportPicker({ list, selected: new Set(list.map((cw) => cw.id)) });
    } catch (ex) {
      setErr(ex?.message || t("pcClassroomListFail"));
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!importPicker) return;
    setImportBusy(true);
    const selected = importPicker.list.filter((cw) => importPicker.selected.has(cw.id));
    const { error } = await importClassroomActivities(supabase, {
      courseId,
      courseWorks: selected,
      createdBy: user.id,
    });
    setImportBusy(false);
    if (error) setErr(error);
    else {
      setImportPicker(null);
      await load();
    }
  };

  const orgName = course?.organizations?.name || t("pcInstitution");

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <PbcLoading label={t("pcLoadingClass")} />
      </main>
    );
  }

  if (!user) return null;

  return (
    <PyBotClassShell
      user={user}
      showAdminTab={superAdmin}
      onSignOut={() => void signOut()}
      contextualRoleLabel={contextualRoleLabel}
      contextualRoleCompact={contextualRoleCompact}
    >
      <PbcPage>
        <PyBotClassBreadcrumb items={[{ label: course?.title || t("pcClass") }]} />

        <PbcCourseHeader
          title={course?.title || "Clase"}
          orgName={orgName}
          classroomLinked={!!course?.classroom_course_id}
          actions={
            canTeach ? (
              <div className="pbc-course-quick-actions">
                <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" onClick={goCreateActivity}>
                  + {t("pcCreateActivity")}
                </button>
                <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={goAddStudents}>
                  + {t("pcAddStudents")}
                </button>
                <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={goAssignContent}>
                  {t("pcAssignContent")}
                </button>
                <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={goSubmissions}>
                  {t("pcViewSubmissions")}
                </button>
                <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={goIntegrations}>
                  {t("pcTabIntegrations")}
                </button>
              </div>
            ) : null
          }
        />

        {profileError ? <PbcAlert variant="error">{profileError}</PbcAlert> : null}
        {err ? <PbcAlert variant="error">{err}</PbcAlert> : null}

        {mode === COURSE_ACCESS_MODES.NONE ? (
          <PbcEmpty title={t("pcNoCourseAccess")} />
        ) : (
          <>
            <CourseTabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setTab(id)} />

            {activeTab === "resumen" ? (
              <CourseSummaryTab
                courseId={courseId}
                mode={mode}
                onGoSubmissions={canTeach ? goSubmissions : undefined}
                onGoStudents={canTeach ? goAddStudents : undefined}
                onGoCreateActivity={canTeach ? goCreateActivity : undefined}
                onGoAssignContent={canTeach ? goAssignContent : undefined}
              />
            ) : null}

            {activeTab === "actividades" ? (
              <CourseActivitiesTab
                activities={activities}
                mode={mode}
                user={user}
                supabase={supabase}
                courseId={courseId}
                saving={false}
                err={err}
                onReload={load}
                onImportClassroom={
                  canTeach && course?.classroom_course_id ? importFromClassroom : null
                }
                importBusy={importBusy}
                openCreate={canTeach && searchParams.get("action") === "create"}
                onCreateOpened={() => {
                  if (searchParams.get("action") === "create") {
                    setTab("actividades");
                  }
                }}
                onAssignContent={canTeach ? goAssignContent : undefined}
              />
            ) : null}

            {activeTab === "alumnos" && mode === COURSE_ACCESS_MODES.TEACHING ? (
              <CourseRosterTab
                orgId={course?.org_id}
                courseId={courseId}
                classroomCourseId={course?.classroom_course_id}
                user={user}
                orgRole={myRole}
                focusInvite={searchParams.get("focus") === "invite"}
                onGoIntegrations={goIntegrations}
              />
            ) : null}

            {activeTab === "entregas" && mode === COURSE_ACCESS_MODES.TEACHING ? (
              <CourseSubmissionsTab courseId={courseId} />
            ) : null}

            {activeTab === "notas" ? (
              <CourseGradesTab
                courseId={courseId}
                canTeach={mode === COURSE_ACCESS_MODES.TEACHING}
              />
            ) : null}

            {activeTab === "integraciones" && mode === COURSE_ACCESS_MODES.TEACHING ? (
              <CourseIntegrationsTab
                courseId={courseId}
                orgId={course?.org_id}
                classroomCourseId={course?.classroom_course_id}
                user={user}
                onReloadActivities={load}
              />
            ) : null}

            {importPicker && mode === COURSE_ACCESS_MODES.TEACHING ? (
              <PbcFormPanel title={t("pcImportFromClassroom")} onCancel={() => setImportPicker(null)}>
                <ul className="pbc-list">
                  {importPicker.list.map((cw) => (
                    <li key={cw.id} className="pbc-list-item">
                      <label style={{ display: "flex", gap: "0.65rem", alignItems: "center", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={importPicker.selected.has(cw.id)}
                          onChange={(e) => {
                            const next = new Set(importPicker.selected);
                            if (e.target.checked) next.add(cw.id);
                            else next.delete(cw.id);
                            setImportPicker({ ...importPicker, selected: next });
                          }}
                        />
                        <span className="pbc-list-item__title">{cw.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="auth-card__actions auth-card__actions--row" style={{ marginTop: "0.85rem" }}>
                  <button
                    type="button"
                    className="auth-btn auth-btn--primary auth-btn--sm"
                    disabled={importBusy}
                    onClick={() => void confirmImport()}
                  >
                    {importBusy ? t("pcImporting") : t("pcImportSelected")}
                  </button>
                </div>
              </PbcFormPanel>
            ) : null}
          </>
        )}

        <div className="pbc-footer-links">
          <Link to="/dashboard/classes" className="auth-link">
            {t("pcMyClassesBack")}
          </Link>
        </div>
      </PbcPage>
    </PyBotClassShell>
  );
}
