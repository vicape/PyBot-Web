import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient.js";
import { listCourseStudents, listCourseTeachers } from "../../classroom/classroomApi.js";
import {
  classroomSyncErrorMessage,
  syncClassroomRosterToCourse,
  syncClassroomTeachersToCourse,
} from "../../classroom/classroomRosterSync.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import { isStaffRole } from "../../orgRole.js";

function MemberList({ rows, onRemove, removingId, badge }) {
  if (!rows.length) return <p className="auth-card__muted">Sin registros.</p>;
  return (
    <ul className="auth-org-list">
      {rows.map((m) => (
        <li key={m.key} className="auth-org-row auth-org-row--split">
          <div>
            <span className="auth-org-row__name">{m.name}</span>
            <span className="auth-org-row__meta">{m.meta}</span>
          </div>
          <div className="auth-org-row__actions">
            {badge ? <span className="dash-badge dash-badge--muted">{badge(m)}</span> : null}
            {onRemove ? (
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={removingId === m.userId}
                onClick={() => void onRemove(m.userId)}
              >
                {removingId === m.userId ? "…" : "Quitar"}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CourseRosterTab({
  orgId,
  courseId,
  classroomCourseId,
  user,
  orgRole,
}) {
  const sb = getSupabase();
  const [subTab, setSubTab] = useState("alumnos");
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [pendingStudents, setPendingStudents] = useState([]);
  const [pendingTeachers, setPendingTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState("");
  const [removingId, setRemovingId] = useState(null);
  const [inviteLink, setInviteLink] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);

  const load = useCallback(async () => {
    if (!sb || !courseId) return;
    setLoading(true);
    const rpc = await sb.rpc("list_course_members", { p_course_id: courseId });
    const rows = rpc.data ?? [];
    setStudents(
      rows
        .filter((r) => r.role === "student")
        .map((r) => ({
          key: r.user_id,
          userId: r.user_id,
          name: r.display_name || r.email || r.user_id,
          meta: r.email || "",
          source: r.source,
        })),
    );
    setTeachers(
      rows
        .filter((r) => r.role === "teacher")
        .map((r) => ({
          key: r.user_id,
          userId: r.user_id,
          name: r.display_name || r.email || r.user_id,
          meta: r.email || "",
          source: r.source,
        })),
    );

    const pendingRpc = await sb.rpc("list_course_roster_pending", { p_course_id: courseId });
    const pending = pendingRpc.data ?? [];
    setPendingStudents(pending.filter((p) => p.role === "student"));
    setPendingTeachers(pending.filter((p) => p.role === "teacher"));
    setLoading(false);
  }, [sb, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncStudents = async () => {
    if (!classroomCourseId) {
      setSyncErr("Este curso no tiene Classroom vinculado.");
      return;
    }
    setSyncBusy(true);
    setSyncErr("");
    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) throw { code: "missing_access_token" };
      const classroomStudents = await listCourseStudents(tok, classroomCourseId);
      const sync = await syncClassroomRosterToCourse(sb, { courseId, orgId, classroomStudents });
      if (!sync.ok) throw { message: sync.error };
      await load();
    } catch (ex) {
      setSyncErr(classroomSyncErrorMessage(ex));
    } finally {
      setSyncBusy(false);
    }
  };

  const syncTeachers = async () => {
    if (!classroomCourseId) {
      setSyncErr("Este curso no tiene Classroom vinculado.");
      return;
    }
    setSyncBusy(true);
    setSyncErr("");
    try {
      const tok = await getValidClassroomToken(user?.id);
      if (!tok) throw { code: "missing_access_token" };
      const classroomTeachers = await listCourseTeachers(tok, classroomCourseId);
      const sync = await syncClassroomTeachersToCourse(sb, {
        courseId,
        orgId,
        classroomTeachers,
        currentUserId: user?.id,
      });
      if (!sync.ok) throw { message: sync.error };
      await load();
    } catch (ex) {
      setSyncErr(classroomSyncErrorMessage(ex));
    } finally {
      setSyncBusy(false);
    }
  };

  const removeMember = async (userId) => {
    setRemovingId(userId);
    await sb.rpc("remove_course_member", { p_course_id: courseId, p_user_id: userId });
    setRemovingId(null);
    await load();
  };

  const generateInvite = async () => {
    setGeneratingInvite(true);
    const { data } = await sb
      .from("organization_invites")
      .insert({
        org_id: orgId,
        course_id: courseId,
        role: "student",
        max_uses: 100,
        created_by: user.id,
      })
      .select("code")
      .maybeSingle();
    setGeneratingInvite(false);
    if (data?.code) setInviteLink(`${window.location.origin}/join?code=${data.code}`);
  };

  const studentRows = [
    ...students.map((s) => ({ ...s, badge: () => "Activo" })),
    ...pendingStudents.map((p) => ({
      key: p.classroom_user_id || p.email,
      userId: null,
      name: p.display_name || p.email,
      meta: p.email,
      badge: () => "Sin login",
    })),
  ];

  const teacherRows = [
    ...teachers.map((t) => ({
      ...t,
      badge: () =>
        isStaffRole(orgRole) && t.userId === user?.id
          ? "Docente institucional"
          : t.source === "manual"
            ? "Co-docente"
            : "Co-docente",
    })),
    ...pendingTeachers.map((p) => ({
      key: p.classroom_user_id || p.email,
      userId: null,
      name: p.display_name || p.email,
      meta: p.email,
      badge: () => "Sin login",
    })),
  ];

  return (
    <>
      <nav className="course-tabs" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={`course-tab${subTab === "alumnos" ? " course-tab--active" : ""}`}
          onClick={() => setSubTab("alumnos")}
        >
          Alumnos
        </button>
        <button
          type="button"
          className={`course-tab${subTab === "docentes" ? " course-tab--active" : ""}`}
          onClick={() => setSubTab("docentes")}
        >
          Docentes
        </button>
      </nav>

      {syncErr ? <p className="auth-card__notice auth-card__notice--err">{syncErr}</p> : null}

      {subTab === "alumnos" ? (
        <>
          <div className="auth-card__actions auth-card__actions--row" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={generatingInvite}
              onClick={() => void generateInvite()}
            >
              {generatingInvite ? "…" : "Invitar alumnos"}
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={syncBusy}
              onClick={() => void syncStudents()}
            >
              {syncBusy ? "Sincronizando…" : "Sincronizar Classroom"}
            </button>
          </div>
          {inviteLink ? (
            <p className="auth-card__muted auth-card__muted--tight" style={{ marginBottom: "1rem" }}>
              Link de invitación: <code>{inviteLink}</code>
            </p>
          ) : null}
          {loading ? (
            <p className="auth-card__muted">Cargando…</p>
          ) : (
            <MemberList rows={studentRows} onRemove={removeMember} removingId={removingId} badge={(m) => m.badge?.()} />
          )}
        </>
      ) : (
        <>
          <div className="auth-card__actions auth-card__actions--row" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={syncBusy}
              onClick={() => void syncTeachers()}
            >
              {syncBusy ? "Sincronizando…" : "Sincronizar Classroom"}
            </button>
          </div>
          {loading ? (
            <p className="auth-card__muted">Cargando…</p>
          ) : (
            <MemberList rows={teacherRows} badge={(m) => m.badge?.()} />
          )}
        </>
      )}
    </>
  );
}
