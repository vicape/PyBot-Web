import { useEffect, useState } from "react";
import { listCourseWork } from "../../classroom/classroomApi.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import {
  countPendingClassroomGrades,
  fetchCourseActivities,
  fetchPybotclassGradebook,
  importClassroomActivities,
} from "../../platform/pybotClassApi.js";
import {
  publishActivityToClassroom,
  sendGradeToClassroom,
  syncClassroomSubmissionsForActivity,
  matchClassroomSubmission,
} from "../../platform/activityClassroom.js";
import { fetchActivitySubmissions } from "../../platform/activitySubmissions.js";
import { getSupabase } from "../../supabaseClient.js";
import {
  classroomSyncErrorMessage,
  syncClassroomRosterToCourse,
  syncClassroomTeachersToCourse,
} from "../../classroom/classroomRosterSync.js";
import { listCourseStudents, listCourseTeachers } from "../../classroom/classroomApi.js";

export default function CourseIntegrationsTab({
  courseId,
  orgId,
  classroomCourseId,
  user,
  onReloadActivities,
}) {
  const sb = getSupabase();
  const [stats, setStats] = useState({ students: 0, teachers: 0, activities: 0, pendingGrades: 0 });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [importList, setImportList] = useState([]);
  const [selectedCw, setSelectedCw] = useState(new Set());
  const [showImport, setShowImport] = useState(false);

  const loadStats = async () => {
    const members = await sb.rpc("list_course_members", { p_course_id: courseId });
    const rows = members.data ?? [];
    const { rows: acts } = await fetchCourseActivities(courseId);
    const { gradebook } = await fetchPybotclassGradebook(courseId);
    setStats({
      students: rows.filter((r) => r.role === "student").length,
      teachers: rows.filter((r) => r.role === "teacher").length,
      activities: acts.length,
      pendingGrades: countPendingClassroomGrades(gradebook),
    });
  };

  useEffect(() => {
    void loadStats();
  }, [courseId]);

  const withToken = async (fn) => {
    setErr("");
    setMsg("");
    const tok = await getValidClassroomToken(user?.id);
    if (!tok) {
      setErr("Classroom no conectado. Conectalo desde tu cuenta.");
      return null;
    }
    return fn(tok);
  };

  const syncStudents = async () => {
    setBusy("students");
    try {
      await withToken(async (tok) => {
        const classroomStudents = await listCourseStudents(tok, classroomCourseId);
        const sync = await syncClassroomRosterToCourse(sb, { courseId, orgId, classroomStudents });
        if (!sync.ok) throw { message: sync.error };
        setMsg(`Alumnos sincronizados (${classroomStudents.length} en Classroom).`);
      });
      await loadStats();
    } catch (ex) {
      setErr(classroomSyncErrorMessage(ex));
    } finally {
      setBusy("");
    }
  };

  const syncTeachers = async () => {
    setBusy("teachers");
    try {
      await withToken(async (tok) => {
        const classroomTeachers = await listCourseTeachers(tok, classroomCourseId);
        const sync = await syncClassroomTeachersToCourse(sb, {
          courseId,
          orgId,
          classroomTeachers,
          currentUserId: user?.id,
        });
        if (!sync.ok) throw { message: sync.error };
        setMsg("Docentes sincronizados.");
      });
      await loadStats();
    } catch (ex) {
      setErr(classroomSyncErrorMessage(ex));
    } finally {
      setBusy("");
    }
  };

  const openImport = async () => {
    setBusy("import-list");
    setErr("");
    try {
      await withToken(async (tok) => {
        const list = await listCourseWork(tok, classroomCourseId);
        setImportList(list);
        setSelectedCw(new Set(list.map((cw) => cw.id)));
        setShowImport(true);
      });
    } catch (ex) {
      setErr(ex?.message || "No se pudo listar actividades de Classroom.");
    } finally {
      setBusy("");
    }
  };

  const doImport = async () => {
    const selected = importList.filter((cw) => selectedCw.has(cw.id));
    setBusy("import");
    const { imported, updated, error } = await importClassroomActivities(sb, {
      courseId,
      courseWorks: selected,
      createdBy: user.id,
    });
    setBusy("");
    if (error) {
      setErr(error);
      return;
    }
    setMsg(`Importadas: ${imported} nuevas, ${updated} actualizadas.`);
    setShowImport(false);
    await onReloadActivities?.();
    await loadStats();
  };

  const publishAll = async () => {
    setBusy("publish");
    setErr("");
    try {
      const { rows: acts } = await fetchCourseActivities(courseId);
      let count = 0;
      for (const a of acts) {
        const res = await publishActivityToClassroom({
          activity: a,
          classroomCourseId,
          userId: user.id,
        });
        if (res.ok) count += 1;
      }
      setMsg(`Publicadas/actualizadas ${count} actividad(es) en Classroom.`);
      await onReloadActivities?.();
    } catch (ex) {
      setErr(ex?.message || "Error al publicar.");
    } finally {
      setBusy("");
    }
  };

  const sendPendingGrades = async () => {
    const { gradebook } = await fetchPybotclassGradebook(courseId);
    const pending = countPendingClassroomGrades(gradebook);
    if (!pending) {
      setMsg("No hay notas pendientes de envío.");
      return;
    }
    const ok = window.confirm(`Se enviarán ${pending} notas a Google Classroom.`);
    if (!ok) return;

    setBusy("grades");
    setErr("");
    try {
      const { rows: acts } = await fetchCourseActivities(courseId);
      const actById = new Map(acts.map((a) => [a.id, a]));
      const members = await sb.rpc("list_course_members", { p_course_id: courseId });
      const classroomUserIdByPybotUser = new Map(
        (members.data ?? [])
          .filter((m) => m.classroom_user_id)
          .map((m) => [m.user_id, m.classroom_user_id]),
      );
      const emailByPybotUser = new Map(
        (members.data ?? []).filter((m) => m.email).map((m) => [m.user_id, m.email]),
      );

      let sent = 0;
      for (const g of gradebook?.grades || []) {
        if (g.classroom_grade_synced_at) continue;
        const activity = actById.get(g.activity_id);
        if (!activity?.classroom_coursework_id || g.grade == null) continue;

        const { rows: subs } = await fetchActivitySubmissions(g.activity_id);
        const pySub = subs.find((s) => s.user_id === g.user_id);
        if (!pySub) continue;

        const sync = await syncClassroomSubmissionsForActivity({
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          userId: user.id,
        });
        if (!sync.ok) continue;

        const match = (sync.rows || []).find((cs) =>
          matchClassroomSubmission(cs, pySub, null, classroomUserIdByPybotUser, emailByPybotUser),
        );
        if (!match?.id) continue;

        const res = await sendGradeToClassroom({
          submission: pySub,
          activity,
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          classroomSubmissionId: match.id,
          userId: user.id,
        });
        if (res.ok) sent += 1;
      }
      setMsg(`Se enviaron ${sent} nota(s) a Classroom.`);
      await loadStats();
    } catch (ex) {
      setErr(ex?.message || "Error al enviar notas.");
    } finally {
      setBusy("");
    }
  };

  if (!classroomCourseId) {
    return (
      <p className="auth-card__muted">
        Esta clase no está vinculada a Google Classroom. Importala desde Classroom en Mis clases.
      </p>
    );
  }

  return (
    <div className="dash-panel" style={{ padding: "1rem" }}>
      <h3 className="auth-section__title">Google Classroom</h3>
      <p className="auth-card__muted">● Conectado</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.75rem", margin: "1rem 0" }}>
        <div><div className="auth-card__muted">Alumnos</div><strong>{stats.students}</strong></div>
        <div><div className="auth-card__muted">Docentes</div><strong>{stats.teachers}</strong></div>
        <div><div className="auth-card__muted">Actividades</div><strong>{stats.activities}</strong></div>
        <div><div className="auth-card__muted">Notas pendientes</div><strong>{stats.pendingGrades}</strong></div>
      </div>

      {err ? <p className="auth-card__notice auth-card__notice--err">{err}</p> : null}
      {msg ? <p className="auth-card__notice">{msg}</p> : null}

      <div className="auth-card__actions auth-card__actions--row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void syncStudents()}>
          {busy === "students" ? "…" : "Sincronizar alumnos"}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void syncTeachers()}>
          {busy === "teachers" ? "…" : "Sincronizar docentes"}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void openImport()}>
          {busy === "import-list" ? "…" : "Importar actividades"}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void publishAll()}>
          {busy === "publish" ? "…" : "Publicar actividades"}
        </button>
        <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" disabled={!!busy} onClick={() => void sendPendingGrades()}>
          {busy === "grades" ? "…" : "Enviar notas pendientes"}
        </button>
      </div>

      {showImport ? (
        <div style={{ marginTop: "1rem" }}>
          <h4 className="auth-section__title">Importar desde Classroom</h4>
          <ul className="auth-org-list">
            {importList.map((cw) => (
              <li key={cw.id} className="auth-org-row">
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedCw.has(cw.id)}
                    onChange={(e) => {
                      const next = new Set(selectedCw);
                      if (e.target.checked) next.add(cw.id);
                      else next.delete(cw.id);
                      setSelectedCw(next);
                    }}
                  />
                  <span>{cw.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="auth-card__actions auth-card__actions--row">
            <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" disabled={busy === "import"} onClick={() => void doImport()}>
              {busy === "import" ? "Importando…" : "Importar seleccionadas"}
            </button>
            <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={() => setShowImport(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
