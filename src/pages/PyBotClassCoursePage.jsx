import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PyBotClassShell, { CourseTabs, PyBotClassBreadcrumb } from "../components/pybotclass/PyBotClassShell.jsx";
import {
  PbcAlert,
  PbcCourseHeader,
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
import { fetchMyOrgRole, isStaffRole, roleLabelEs } from "../orgRole.js";
import { canTeachCourse, fetchMyCourseRole, isCourseStudent } from "../platform/courseRole.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import {
  fetchCourseActivities,
  fetchCourseBasics,
  importClassroomActivities,
} from "../platform/pybotClassApi.js";
import { listCourseWork } from "../classroom/classroomApi.js";
import { getValidClassroomToken } from "../platform/classroomToken.js";

const TEACHER_TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "actividades", label: "Actividades" },
  { id: "alumnos", label: "Alumnos" },
  { id: "entregas", label: "Entregas" },
  { id: "notas", label: "Notas" },
  { id: "integraciones", label: "Integraciones" },
];

const STUDENT_TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "actividades", label: "Actividades" },
  { id: "notas", label: "Notas" },
];

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

  const orgStaff = isStaffRole(myRole);
  const canTeach = canTeachCourse({ orgRole: myRole, courseRole });
  const isStudent = isCourseStudent({ courseRole });

  const tabs = canTeach ? TEACHER_TABS : STUDENT_TABS;
  const rawTab = searchParams.get("tab") || "resumen";
  const activeTab = tabs.some((t) => t.id === rawTab) ? rawTab : "resumen";
  const setTab = (tabId) => setSearchParams(tabId === "resumen" ? {} : { tab: tabId }, { replace: true });

  const roleDisplay = orgStaff
    ? roleLabelEs(myRole)
    : courseRole === "teacher"
      ? "Co-docente"
      : roleLabelEs(courseRole || myRole);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const load = useCallback(async () => {
    if (!supabase || !courseId || !user) return;
    setLoading(true);
    setErr("");

    const [{ course: c, error: cErr }, admin] = await Promise.all([
      fetchCourseBasics(courseId),
      isSuperAdmin(supabase, user.id),
    ]);
    setSuperAdmin(admin);

    if (cErr || !c) {
      setErr(cErr || "Clase no encontrada.");
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
      setErr("Esta clase no tiene Classroom vinculado.");
      return;
    }
    setImportBusy(true);
    setErr("");
    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) throw new Error("Classroom no conectado.");
      const list = await listCourseWork(tok, course.classroom_course_id);
      setImportPicker({ list, selected: new Set(list.map((cw) => cw.id)) });
    } catch (ex) {
      setErr(ex?.message || "No se pudo listar Classroom.");
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

  const orgName = course?.organizations?.name || "Colegio";

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center">
        <PbcLoading label="Cargando clase…" />
      </main>
    );
  }

  if (!user) return null;

  return (
    <PyBotClassShell user={user} showAdminTab={superAdmin} onSignOut={() => void signOut()}>
      <PbcPage>
        <PyBotClassBreadcrumb items={[{ label: course?.title || "Clase" }]} />

        <PbcCourseHeader
          title={course?.title || "Clase"}
          orgName={orgName}
          roleLabel={canTeach ? roleDisplay : `Tu rol: ${roleDisplay}`}
          classroomLinked={!!course?.classroom_course_id}
        />

        {profileError ? <PbcAlert variant="error">{profileError}</PbcAlert> : null}
        {err ? <PbcAlert variant="error">{err}</PbcAlert> : null}

        <CourseTabs tabs={tabs} activeTab={activeTab} onTabChange={setTab} />

        {activeTab === "resumen" ? (
          <CourseSummaryTab
            courseId={courseId}
            canTeach={canTeach}
            onGoSubmissions={canTeach ? () => setTab("entregas") : undefined}
          />
        ) : null}

        {activeTab === "actividades" ? (
          <CourseActivitiesTab
            activities={activities}
            canTeach={canTeach}
            isStudent={isStudent}
            user={user}
            supabase={supabase}
            courseId={courseId}
            saving={false}
            err={err}
            onReload={load}
            onImportClassroom={canTeach && course?.classroom_course_id ? importFromClassroom : null}
            importBusy={importBusy}
          />
        ) : null}

        {activeTab === "alumnos" && canTeach ? (
          <CourseRosterTab
            orgId={course?.org_id}
            courseId={courseId}
            classroomCourseId={course?.classroom_course_id}
            user={user}
            orgRole={myRole}
          />
        ) : null}

        {activeTab === "entregas" && canTeach ? <CourseSubmissionsTab courseId={courseId} /> : null}

        {activeTab === "notas" ? <CourseGradesTab courseId={courseId} canTeach={canTeach} /> : null}

        {activeTab === "integraciones" && canTeach ? (
          <CourseIntegrationsTab
            courseId={courseId}
            orgId={course?.org_id}
            classroomCourseId={course?.classroom_course_id}
            user={user}
            onReloadActivities={load}
          />
        ) : null}

        {importPicker ? (
          <PbcFormPanel title="Importar desde Classroom" onCancel={() => setImportPicker(null)}>
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
                {importBusy ? "Importando…" : "Importar seleccionadas"}
              </button>
            </div>
          </PbcFormPanel>
        ) : null}

        <div className="pbc-footer-links">
          <Link to="/dashboard/classes" className="auth-link">
            ← Mis clases
          </Link>
          <Link to={`/dashboard/org/${course?.org_id}/course/${courseId}`} className="auth-link">
            Vista clásica
          </Link>
        </div>
      </PbcPage>
    </PyBotClassShell>
  );
}
