import { t } from "../../i18n.js";
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
  fetchCachedClassroomSubmissions,
  publishActivityToClassroom,
  sendGradeToClassroom,
  syncClassroomSubmissionsForActivity,
  matchClassroomSubmission,
} from "../../platform/activityClassroom.js";
import { fetchActivitySubmissions } from "../../platform/activitySubmissions.js";
import { getSupabase } from "../../supabaseClient.js";
import {
  syncClassroomRosterToCourse,
  syncClassroomTeachersToCourse,
} from "../../classroom/classroomRosterSync.js";
import { listCourseStudents, listCourseTeachers } from "../../classroom/classroomApi.js";
import {
  PbcAlert,
  PbcEmpty,
  PbcFormPanel,
  PbcSection,
  PbcStatGrid,
} from "./PyBotClassUi.jsx";

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
      setErr(t("pcClassroomConnectFromAccount"));
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
        setMsg(`${t("pcStudentsSynced")} (${classroomStudents.length} ${t("pcInClassroom")}).`);
      });
      await loadStats();
    } catch (ex) {
      setErr(ex?.message || t("pcClassroomSyncError"));
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
        setMsg(t("pcTeachersSynced"));
      });
      await loadStats();
    } catch (ex) {
      setErr(ex?.message || t("pcClassroomSyncError"));
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
      setErr(ex?.message || t("pcClassroomListFail"));
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
    setMsg(`${t("pcImportedLabel")}: ${imported} · ${t("pcUpdatedLabel")}: ${updated}.`);
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
      setMsg(`${t("pcPublishedUpdated")}: ${count} ${t("pcActivities")} ${t("pcInClassroom")}.`);
      await onReloadActivities?.();
    } catch (ex) {
      setErr(ex?.message || t("pcPublishError"));
    } finally {
      setBusy("");
    }
  };

  const sendPendingGrades = async () => {
    const { gradebook } = await fetchPybotclassGradebook(courseId);
    const pending = countPendingClassroomGrades(gradebook);
    if (!pending) {
      setMsg(t("pcNoPendingGrades"));
      return;
    }
    const ok = window.confirm(`${t("pcGradesWillSend")} ${pending} ${t("pcTabGrades")} ${t("pcInClassroom")}.`);
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

        let classroomSubmissionId = pySub.classroom_submission_id || null;

        if (!classroomSubmissionId) {
          const cached = await fetchCachedClassroomSubmissions(activity.id);
          const fromCache = (cached.rows || []).find((cs) =>
            matchClassroomSubmission(cs, pySub, null, classroomUserIdByPybotUser, emailByPybotUser),
          );
          classroomSubmissionId = fromCache?.id || null;
        }

        if (!classroomSubmissionId) {
          const sync = await syncClassroomSubmissionsForActivity({
            activityId: activity.id,
            classroomCourseId,
            courseWorkId: activity.classroom_coursework_id,
            userId: user.id,
          });
          if (!sync.ok) continue;
          const match = (sync.rows || []).find((cs) =>
            matchClassroomSubmission(cs, pySub, null, classroomUserIdByPybotUser, emailByPybotUser),
          );
          classroomSubmissionId = match?.id || null;
        }

        if (!classroomSubmissionId) continue;

        const res = await sendGradeToClassroom({
          submission: pySub,
          activity,
          classroomCourseId,
          courseWorkId: activity.classroom_coursework_id,
          classroomSubmissionId,
          userId: user.id,
        });
        if (res.ok) sent += 1;
      }
      setMsg(`${t("pcGradesSent")}: ${sent} ${t("pcTabGrades")} ${t("pcInClassroom")}.`);
      await loadStats();
    } catch (ex) {
      setErr(ex?.message || t("pcSendGradesError"));
    } finally {
      setBusy("");
    }
  };

  if (!classroomCourseId) {
    return (
      <PbcEmpty
        title={t("pcClassroomNotLinked")}
        description={t("pcClassroomNotLinkedDesc")}
      />
    );
  }

  return (
    <PbcSection
      title={t("pcGoogleClassroom")}
      description={t("pcClassroomSyncDesc")}
      actions={<span className="pbc-pill pbc-pill--classroom">{t("pcConnected")}</span>}
    >
      <PbcStatGrid
        items={[
          { label: t("pcTabStudents"), value: stats.students, highlight: true },
          { label: t("pcTeachers"), value: stats.teachers },
          { label: t("pcActivities"), value: stats.activities },
          { label: t("pcPendingGrades"), value: stats.pendingGrades, warn: stats.pendingGrades > 0 },
        ]}
      />

      {err ? <PbcAlert variant="error">{err}</PbcAlert> : null}
      {msg ? <PbcAlert variant="info">{msg}</PbcAlert> : null}

      <div className="pbc-section__actions" style={{ marginTop: "1rem" }}>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void syncStudents()}>
          {busy === "students" ? "…" : t("pcSyncStudents")}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void syncTeachers()}>
          {busy === "teachers" ? "…" : t("pcSyncTeachers")}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void openImport()}>
          {busy === "import-list" ? "…" : t("pcImportActivities")}
        </button>
        <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" disabled={!!busy} onClick={() => void publishAll()}>
          {busy === "publish" ? "…" : t("pcPublishActivities")}
        </button>
        <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" disabled={!!busy} onClick={() => void sendPendingGrades()}>
          {busy === "grades" ? "…" : t("pcSendPendingGrades")}
        </button>
      </div>

      {showImport ? (
        <PbcFormPanel title={t("pcImportFromClassroom")} onCancel={() => setShowImport(false)}>
          <ul className="pbc-list">
            {importList.map((cw) => (
              <li key={cw.id} className="pbc-list-item">
                <label style={{ display: "flex", gap: "0.65rem", alignItems: "center", cursor: "pointer" }}>
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
                  <span className="pbc-list-item__title">{cw.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="auth-card__actions auth-card__actions--row" style={{ marginTop: "0.85rem" }}>
            <button type="button" className="auth-btn auth-btn--primary auth-btn--sm" disabled={busy === "import"} onClick={() => void doImport()}>
              {busy === "import" ? t("pcImporting") : t("pcImportSelected")}
            </button>
          </div>
        </PbcFormPanel>
      ) : null}
    </PbcSection>
  );
}
