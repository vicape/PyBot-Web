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
  canShowCourseRoleChangeAction,
  updateCourseMemberRole,
} from "../../platform/courseMemberRoleApi.js";
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

function RoleChangeConfirmModal({ open, member, busy, error, onCancel, onConfirm }) {
  if (!open || !member) return null;
  const promoting = member.nextRole === "teacher";
  const titleId = "course-role-change-title";
  const descId = "course-role-change-desc";
  return (
    <div
      className="pbc-modal-backdrop pbc-modal-backdrop--create-content"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="pbc-modal pbc-modal--create-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="pbc-modal__title">
          {t("pcCourseRoleLabel")}
        </h2>
        <p id={descId} className="pbc-modal--create-content__subtitle">
          {(promoting ? t("pcCourseRolePromoteConfirm") : t("pcCourseRoleDemoteConfirm")).replace(
            "{name}",
            member.name,
          )}
        </p>
        <p className="pbc-modal--create-content__subtitle">
          {promoting ? t("pcCourseRolePromoteDetail") : t("pcCourseRoleDemoteDetail")}
        </p>
        {error ? <p className="pbc-alert pbc-alert--error">{error}</p> : null}
        <div className="pbc-modal__actions">
          <button type="button" className="pbc-btn pbc-btn--ghost" onClick={onCancel} disabled={busy}>
            {t("pcCancel")}
          </button>
          <button
            type="button"
            className="pbc-btn pbc-btn--primary"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy
              ? "…"
              : promoting
                ? t("pcCourseRoleChangeToTeacher")
                : t("pcCourseRoleChangeToStudent")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberList({
  rows,
  onRemove,
  removingId,
  badge,
  canManageRoster,
  actorUserId,
  onRequestRoleChange,
  roleChangingId,
}) {
  if (!rows.length) {
    return <p className="auth-card__muted">{t("pcNoRecords")}</p>;
  }
  return (
    <PbcList>
      {rows.map((m) => {
        const showRoleChange = canShowCourseRoleChangeAction({
          memberUserId: m.userId,
          actorUserId,
          canManageRoster,
          isPending: !m.userId,
        });
        const showRemove = Boolean(onRemove && m.userId);
        const nextRole = m.courseRole === "teacher" ? "student" : "teacher";
        const actions =
          showRoleChange || showRemove ? (
            <div className="pbc-list-item__actions-row">
              {showRoleChange ? (
                <div className="pbc-course-role-action">
                  <span className="pbc-course-role-action__label" id={`course-role-${m.userId}`}>
                    {t("pcCourseRoleLabel")}
                  </span>
                  <button
                    type="button"
                    className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                    aria-labelledby={`course-role-${m.userId}`}
                    aria-label={`${t("pcCourseRoleLabel")}: ${
                      m.courseRole === "teacher" ? t("pcTeacher") : t("pcStudent")
                    }. ${
                      nextRole === "teacher"
                        ? t("pcCourseRoleChangeToTeacher")
                        : t("pcCourseRoleChangeToStudent")
                    }`}
                    disabled={roleChangingId === m.userId}
                    onClick={() =>
                      onRequestRoleChange?.({
                        userId: m.userId,
                        name: m.name,
                        currentRole: m.courseRole,
                        nextRole,
                      })
                    }
                  >
                    {roleChangingId === m.userId
                      ? "…"
                      : nextRole === "teacher"
                        ? t("pcCourseRoleChangeToTeacher")
                        : t("pcCourseRoleChangeToStudent")}
                  </button>
                </div>
              ) : null}
              {showRemove ? (
                <button
                  type="button"
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                  disabled={removingId === m.userId}
                  onClick={() => void onRemove(m.userId)}
                >
                  {removingId === m.userId ? "…" : t("pcRemove")}
                </button>
              ) : null}
            </div>
          ) : null;
        return (
          <PbcListItem
            key={m.key}
            title={m.name}
            meta={m.meta}
            badges={badge ? <span className="pbc-pill pbc-pill--muted">{badge(m)}</span> : null}
            actions={actions}
          />
        );
      })}
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
  const [roleErr, setRoleErr] = useState("");
  const [roleChangingId, setRoleChangingId] = useState(null);
  const [roleConfirm, setRoleConfirm] = useState(null);

  // Personas is only mounted in teaching mode; keep explicit gate for the control.
  const canManageRoster = true;

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
          courseRole: "student",
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
          courseRole: "teacher",
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

  const requestRoleChange = (member) => {
    setRoleErr("");
    setFeedback("");
    setRoleConfirm(member);
  };

  const confirmRoleChange = async () => {
    if (!roleConfirm || !sb) return;
    setRoleChangingId(roleConfirm.userId);
    setRoleErr("");
    setFeedback("");

    const result = await updateCourseMemberRole(sb, {
      courseId,
      userId: roleConfirm.userId,
      role: roleConfirm.nextRole,
      actorUserId: user?.id,
    });

    if (!result.ok) {
      setRoleErr(t("pcCourseRoleChangeError"));
      setRoleChangingId(null);
      await load();
      return;
    }

    const nextSubTab = roleConfirm.nextRole === "teacher" ? "docentes" : "alumnos";
    setRoleConfirm(null);
    setRoleChangingId(null);
    setFeedback(
      roleConfirm.nextRole === "teacher"
        ? t("pcCourseRoleChangedToTeacher").replace("{name}", roleConfirm.name)
        : t("pcCourseRoleChangedToStudent").replace("{name}", roleConfirm.name),
    );
    setSubTab(nextSubTab);
    await load();
  };

  const generateInvite = async () => {
    setGeneratingInvite(true);
    setFeedback("");
    const payload = {
      course_id: courseId,
      role: "student",
      max_uses: 100,
      created_by: user.id,
    };
    // Personal courses have no institution; institutional invites keep org_id.
    if (orgId) payload.org_id = orgId;
    const { data } = await sb
      .from("organization_invites")
      .insert(payload)
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
      courseRole: "student",
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
      courseRole: "teacher",
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
      {roleErr && !roleConfirm ? (
        <PbcAlert variant="error">
          <p className="pbc-alert__text">{roleErr}</p>
        </PbcAlert>
      ) : null}
      {syncErr ? (
        <PbcAlert variant="error">
          <p className="pbc-alert__text">{syncErr}</p>
          {onGoIntegrations ? (
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-alert__action"
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
                className="pbc-btn pbc-btn--primary pbc-btn--sm"
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
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={async () => {
                        const ok = await copyText(inviteCode);
                        if (ok) setFeedback(t("pcCodeCopied"));
                      }}
                    >
                      {t("pcCopyCode")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
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
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm"
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
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={onGoIntegrations}
                    >
                      {t("pcGoIntegrations")}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <h3 className="pbc-section__title pbc-stack">
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
                    className="pbc-btn pbc-btn--primary pbc-btn--sm"
                    onClick={() => {
                      inviteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {t("pcInviteStudents")}
                  </button>
                  {classroomCourseId ? (
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
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
            <MemberList
              rows={studentRows}
              onRemove={removeMember}
              removingId={removingId}
              badge={(m) => m.badge?.()}
              canManageRoster={canManageRoster}
              actorUserId={user?.id}
              onRequestRoleChange={requestRoleChange}
              roleChangingId={roleChangingId}
            />
          )}
        </>
      ) : (
        <>
          <div className="pbc-section__actions pbc-stack--before">
            {classroomCourseId ? (
              <button
                type="button"
                className="pbc-btn pbc-btn--primary pbc-btn--sm"
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
            <MemberList
              rows={teacherRows}
              badge={(m) => m.badge?.()}
              canManageRoster={canManageRoster}
              actorUserId={user?.id}
              onRequestRoleChange={requestRoleChange}
              roleChangingId={roleChangingId}
            />
          )}
        </>
      )}

      <RoleChangeConfirmModal
        open={Boolean(roleConfirm)}
        member={roleConfirm}
        busy={Boolean(roleChangingId)}
        error={roleErr && roleConfirm ? roleErr : ""}
        onCancel={() => {
          if (roleChangingId) return;
          setRoleConfirm(null);
          setRoleErr("");
        }}
        onConfirm={confirmRoleChange}
      />
    </PbcSection>
  );
}
