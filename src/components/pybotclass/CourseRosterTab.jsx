import { t } from "../../i18n.js";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../../supabaseClient.js";
import { listCourseStudents, listCourseTeachers } from "../../classroom/classroomApi.js";
import {
  syncClassroomRosterToCourse,
  syncClassroomTeachersToCourse,
} from "../../classroom/classroomRosterSync.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import { isStaffRole } from "../../orgRole.js";
import {
  PbcAlert,
  PbcList,
  PbcListItem,
  PbcLoading,
  PbcSection,
  PbcSubTabs,
} from "./PyBotClassUi.jsx";

function MemberList({ rows, onRemove, removingId, badge }) {
  if (!rows.length) {
    return <p className="auth-card__muted">{t("pcNoRecords")}</p>;
  }
  return (
    <PbcList>
      {rows.map((m) => (
        <PbcListItem
          key={m.key}
          title={m.name}
          meta={m.meta}
          badges={badge ? <span className="pbc-pill pbc-pill--muted">{badge(m)}</span> : null}
          actions={
            onRemove && m.userId ? (
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={removingId === m.userId}
                onClick={() => void onRemove(m.userId)}
              >
                {removingId === m.userId ? "…" : t("pcRemove")}
              </button>
            ) : null
          }
        />
      ))}
    </PbcList>
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
      setSyncErr(t("pcClassroomNotLinkedCourse"));
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
      setSyncErr(ex?.message || t("pcClassroomSyncError"));
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
      setSyncErr(ex?.message || t("pcClassroomSyncError"));
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
    ...students.map((s) => ({ ...s, badge: () => t("pcActive") })),
    ...pendingStudents.map((p) => ({
      key: p.classroom_user_id || p.email,
      userId: null,
      name: p.display_name || p.email,
      meta: p.email,
      badge: () => t("pcNoLogin"),
    })),
  ];

  const teacherRows = [
    ...teachers.map((t) => ({
      ...t,
      badge: () =>
        isStaffRole(orgRole) && t.userId === user?.id
          ? t("pcInstitutionalTeacher")
          : t.source === "manual"
            ? t("pcCoTeacher")
            : t("pcCoTeacher"),
    })),
    ...pendingTeachers.map((p) => ({
      key: p.classroom_user_id || p.email,
      userId: null,
      name: p.display_name || p.email,
      meta: p.email,
      badge: () => t("pcNoLogin"),
    })),
  ];

  return (
    <PbcSection title={t("pcPeopleClass")}>
      <PbcSubTabs
        tabs={[
          { id: "alumnos", label: t("pcTabStudents") },
          { id: "docentes", label: t("pcTeachers") },
        ]}
        active={subTab}
        onChange={setSubTab}
      />

      {syncErr ? <PbcAlert variant="error">{syncErr}</PbcAlert> : null}

      {subTab === "alumnos" ? (
        <>
          <div className="pbc-section__actions" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={generatingInvite}
              onClick={() => void generateInvite()}
            >
              {generatingInvite ? "…" : t("pcInviteStudents")}
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={syncBusy}
              onClick={() => void syncStudents()}
            >
              {syncBusy ? t("pcSyncing") : t("pcSyncClassroom")}
            </button>
          </div>
          {inviteLink ? (
            <p className="pbc-alert pbc-alert--info" style={{ marginBottom: "1rem" }}>
              {t("pcInvitationLink")} <code>{inviteLink}</code>
            </p>
          ) : null}
          {loading ? (
            <PbcLoading label={t("pcLoadingStudents")} />
          ) : (
            <MemberList rows={studentRows} onRemove={removeMember} removingId={removingId} badge={(m) => m.badge?.()} />
          )}
        </>
      ) : (
        <>
          <div className="pbc-section__actions" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={syncBusy}
              onClick={() => void syncTeachers()}
            >
              {syncBusy ? t("pcSyncing") : t("pcSyncClassroom")}
            </button>
          </div>
          {loading ? (
            <PbcLoading label={t("pcLoadingTeachers")} />
          ) : (
            <MemberList rows={teacherRows} badge={(m) => m.badge?.()} />
          )}
        </>
      )}
    </PbcSection>
  );
}
