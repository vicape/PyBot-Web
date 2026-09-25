import { t } from "../../i18n.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "../../supabaseClient.js";
import { listCourseStudents, listCourseTeachers } from "../../classroom/classroomApi.js";
import {
  syncClassroomRosterToCourse,
  syncClassroomTeachersToCourse,
} from "../../classroom/classroomRosterSync.js";
import { getValidClassroomToken } from "../../platform/classroomToken.js";
import { isStaffRole } from "../../orgRole.js";
import { mapClassroomSyncUserError, shouldAutoCreateInviteOnNavigate } from "../../platform/uxIaHelpers.js";
import {
  PbcAlert,
  PbcEmpty,
  PbcList,
  PbcListItem,
  PbcLoading,
  PbcSection,
  PbcSubTabs,
} from "./PyBotClassUi.jsx";

async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

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
  focusInvite = false,
  onGoIntegrations,
}) {
  const sb = getSupabase();
  const inviteSectionRef = useRef(null);
  const [subTab, setSubTab] = useState("alumnos");
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [pendingStudents, setPendingStudents] = useState([]);
  const [pendingTeachers, setPendingTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState("");
  const [removingId, setRemovingId] = useState(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Invite generation remains explicit — opening/navigating never creates one.
  if (shouldAutoCreateInviteOnNavigate()) {
    // Intentionally unreachable: navigation alone must not create invites.
  }

  useEffect(() => {
    if (!focusInvite) return;
    requestAnimationFrame(() => {
      inviteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusInvite]);

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
      setSyncErr(t("pcClassroomSyncNeedLink"));
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
      setFeedback(t("pcStudentsSynced"));
      await load();
    } catch (ex) {
      const mapped = mapClassroomSyncUserError(ex);
      if (mapped.kind === "reconnect") setSyncErr(t("pcClassroomSyncNeedReconnect"));
      else if (mapped.kind === "link_integrations") setSyncErr(t("pcClassroomSyncNeedLink"));
      else setSyncErr(mapped.raw || t("pcClassroomSyncError"));
    } finally {
      setSyncBusy(false);
    }
  };

  const syncTeachers = async () => {
    if (!classroomCourseId) {
      setSyncErr(t("pcClassroomSyncNeedLink"));
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
      setFeedback(t("pcTeachersSynced"));
      await load();
    } catch (ex) {
      const mapped = mapClassroomSyncUserError(ex);
      if (mapped.kind === "reconnect") setSyncErr(t("pcClassroomSyncNeedReconnect"));
      else if (mapped.kind === "link_integrations") setSyncErr(t("pcClassroomSyncNeedLink"));
      else setSyncErr(mapped.raw || t("pcClassroomSyncError"));
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
    setFeedback("");
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
    if (data?.code) {
      setInviteCode(data.code);
      setInviteLink(`${window.location.origin}/join?code=${data.code}`);
      setFeedback(t("pcInviteCreated"));
    }
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
    ...teachers.map((row) => ({
      ...row,
      badge: () =>
        isStaffRole(orgRole) && row.userId === user?.id
          ? t("pcInstitutionalTeacher")
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

  const studentCount = studentRows.length;

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

      {feedback ? <p className="pbc-feedback" role="status">{feedback}</p> : null}
      {syncErr ? (
        <PbcAlert variant="error">
          <p style={{ margin: 0 }}>{syncErr}</p>
          {onGoIntegrations ? (
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              style={{ marginTop: "0.5rem" }}
              onClick={onGoIntegrations}
            >
              {t("pcGoIntegrations")}
            </button>
          ) : null}
        </PbcAlert>
      ) : null}

      {subTab === "alumnos" ? (
        <>
          <section
            ref={inviteSectionRef}
            id="agregar-alumnos"
            className="pbc-add-students"
            aria-labelledby="add-students-heading"
          >
            <h3 id="add-students-heading" className="pbc-section__title">
              {t("pcAddStudents")}
            </h3>

            <div className="pbc-add-students__block">
              <h4 className="pbc-add-students__subtitle">{t("pcInviteWithPyBot")}</h4>
              <p className="auth-card__muted">{t("pcInviteWithPyBotDesc")}</p>
              <button
                type="button"
                className="auth-btn auth-btn--primary auth-btn--sm"
                disabled={generatingInvite}
                onClick={() => void generateInvite()}
              >
                {generatingInvite ? "…" : t("pcGenerateInvite")}
              </button>
              {inviteCode ? (
                <div className="pbc-invite-result" role="status">
                  <p>
                    <strong>{t("pcInvitationCode")}:</strong> <code>{inviteCode}</code>
                  </p>
                  <p>
                    <strong>{t("pcInvitationLinkLabel")}:</strong> <code>{inviteLink}</code>
                  </p>
                  <div className="pbc-invite-result__actions">
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      onClick={async () => {
                        const ok = await copyText(inviteCode);
                        if (ok) setFeedback(t("pcCodeCopied"));
                      }}
                    >
                      {t("pcCopyCode")}
                    </button>
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      onClick={async () => {
                        const ok = await copyText(inviteLink);
                        if (ok) setFeedback(t("pcLinkCopied"));
                      }}
                    >
                      {t("pcCopyLink")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="pbc-add-students__block">
              <h4 className="pbc-add-students__subtitle">{t("pcInviteWithClassroom")}</h4>
              <p className="auth-card__muted">{t("pcInviteWithClassroomDesc")}</p>
              <p className="auth-card__muted">{t("pcClassroomOptionalHint")}</p>
              {classroomCourseId ? (
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  disabled={syncBusy}
                  onClick={() => void syncStudents()}
                >
                  {syncBusy ? t("pcSyncing") : t("pcSyncClassroom")}
                </button>
              ) : (
                <div className="pbc-add-students__classroom-off">
                  <p className="auth-card__muted">{t("pcClassroomNotLinkedCourse")}</p>
                  {onGoIntegrations ? (
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      onClick={onGoIntegrations}
                    >
                      {t("pcGoIntegrations")}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <h3 className="pbc-section__title" style={{ marginTop: "1.5rem" }}>
            {t("pcCourseStudentsHeading").replace("{n}", String(studentCount))}
          </h3>

          {loading ? (
            <PbcLoading label={t("pcLoadingStudents")} />
          ) : studentCount === 0 ? (
            <PbcEmpty
              title={t("pcStudentsEmptyTitle")}
              description={t("pcStudentsEmptyDesc")}
              actions={
                <div className="pbc-empty__actions-row">
                  <button
                    type="button"
                    className="auth-btn auth-btn--primary auth-btn--sm"
                    onClick={() => {
                      inviteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {t("pcInviteStudents")}
                  </button>
                  {classroomCourseId ? (
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={syncBusy}
                      onClick={() => void syncStudents()}
                    >
                      {t("pcSyncClassroom")}
                    </button>
                  ) : null}
                </div>
              }
            />
          ) : (
            <MemberList rows={studentRows} onRemove={removeMember} removingId={removingId} badge={(m) => m.badge?.()} />
          )}
        </>
      ) : (
        <>
          <div className="pbc-section__actions" style={{ marginBottom: "1rem" }}>
            {classroomCourseId ? (
              <button
                type="button"
                className="auth-btn auth-btn--primary auth-btn--sm"
                disabled={syncBusy}
                onClick={() => void syncTeachers()}
              >
                {syncBusy ? t("pcSyncing") : t("pcSyncClassroom")}
              </button>
            ) : (
              <p className="auth-card__muted">{t("pcClassroomOptionalHint")}</p>
            )}
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
