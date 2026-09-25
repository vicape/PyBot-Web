import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ContentCard from "../components/pybotclass/content/ContentCard.jsx";
import CreateContentModal from "../components/pybotclass/content/CreateContentModal.jsx";
import DeleteContentModal from "../components/pybotclass/content/DeleteContentModal.jsx";
import EditContentModal from "../components/pybotclass/content/EditContentModal.jsx";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";
import ShareContentModal from "../components/content-editor/ShareContentModal.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import MyContentEmptyIllustration from "../components/pybotclass/illustrations/MyContentEmptyIllustration.jsx";
import { CompactContentIcon } from "../components/pybotclass/illustrations/ActionIcons.jsx";
import { copyLearningContent, listMyContents } from "../platform/contentApi.js";
import { listTeacherCoursesForAssign } from "../platform/contentAssignApi.js";
import { getMyContentUsageMetrics } from "../platform/contentShareApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import { t } from "../i18n.js";

export default function MyContentPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const assignToCourse = searchParams.get("assignToCourse");
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/content");
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [feedback, setFeedback] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [teacherCourses, setTeacherCourses] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [copyBusyId, setCopyBusyId] = useState(null);
  const [usageById, setUsageById] = useState({});
  const [usageUnavailable, setUsageUnavailable] = useState(false);

  const assignCourseTitle = useMemo(() => {
    if (!assignToCourse) return null;
    const row = teacherCourses.find((c) => c.course_id === assignToCourse);
    return row?.course_title || row?.title || null;
  }, [assignToCourse, teacherCourses]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }, [supabase, navigate]);

  const loadUsage = useCallback(async () => {
    const { rows: metrics, unavailable } = await getMyContentUsageMetrics();
    if (unavailable) {
      setUsageUnavailable(true);
      setUsageById({});
      return;
    }
    setUsageUnavailable(false);
    const map = {};
    for (const m of metrics || []) {
      map[m.content_id] = m;
    }
    setUsageById(map);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");
    const [{ rows, error }, { profile }, teacherCoursesRes] = await Promise.all([
      listMyContents(),
      fetchProfile(user.id),
      listTeacherCoursesForAssign(),
    ]);
    await loadUsage();
    setSuperAdmin(isSuperAdmin(profile));
    setTeacherCourses(teacherCoursesRes.rows || []);
    setCanAssign((teacherCoursesRes.rows || []).length > 0);
    if (error) setErr(error);
    setContents(rows);
    setLoading(false);
  }, [user, loadUsage]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (!authLoading && user) void load();
  }, [authLoading, user, load, navigate]);

  const handleCopy = async (content) => {
    if (!content?.id || copyBusyId) return;
    setCopyBusyId(content.id);
    setErr("");
    const { content: copy, error } = await copyLearningContent(content.id);
    setCopyBusyId(null);
    if (error || !copy) {
      setErr(error === "forbidden_read" ? t("pcCopyFail") : error || t("pcCopyFail"));
      return;
    }
    navigate(`/dashboard/content/${copy.id}`);
  };

  const clearAssignIntent = () => {
    if (!assignToCourse) return;
    const next = new URLSearchParams(searchParams);
    next.delete("assignToCourse");
    setSearchParams(next, { replace: true });
  };

  if (authLoading || loading) {
    return (
      <main className="dash-root dash-root--center" role="status">
        <p>{t("pcLoadingGeneric")}</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} hideSearch onSignOut={() => void signOut()}>
      {profileError ? (
        <div className="pbc-alert pbc-alert--error" role="alert">
          {profileError}
        </div>
      ) : null}
      {err ? (
        <div className="pbc-alert pbc-alert--error" role="alert">
          {err}
        </div>
      ) : null}
      {feedback ? (
        <p className="pbc-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="pbc-content-page">
        <header className="pbc-hero-block pbc-content-page__head">
          <div className="pbc-hero-block__text">
            <h1 className="pbc-hero-block__title">{t("pcNavContent")}</h1>
            <p className="pbc-hero-block__subtitle">{t("pcContentPageLead")}</p>
          </div>
          <div className="pbc-hero-block__actions">
            {!assignToCourse ? (
              <button type="button" className="pbc-btn pbc-btn--primary" onClick={() => setShowCreate(true)}>
                <span aria-hidden>
                  <CompactContentIcon />
                </span>
                {t("pcCreateContent")}
              </button>
            ) : (
              <button type="button" className="pbc-btn pbc-btn--ghost" onClick={clearAssignIntent}>
                {t("pcCancel")}
              </button>
            )}
          </div>
        </header>

        {assignToCourse ? (
          <div className="pbc-assign-intent" role="status">
            <p className="pbc-assign-intent__text">
              {t("pcAssignToCourseIntent").replace("{course}", assignCourseTitle || assignToCourse)}
            </p>
          </div>
        ) : null}

        {contents.length === 0 ? (
          <div className="pbc-empty-state pbc-empty-state--content">
            <span className="pbc-empty-state__illus" aria-hidden>
              <MyContentEmptyIllustration />
            </span>
            <h3 className="pbc-empty-state__title">{t("pcContentEmptyTitle")}</h3>
            <p className="pbc-empty-state__desc">{t("pcContentEmptyDesc")}</p>
            <div className="pbc-empty-state__actions">
              <button type="button" className="pbc-btn pbc-btn--primary" onClick={() => setShowCreate(true)}>
                <span aria-hidden>
                  <CompactContentIcon />
                </span>
                {t("pcCreateContent")}
              </button>
            </div>
          </div>
        ) : (
          <div className="pbc-content-grid">
            {contents.map((c) => (
              <ContentCard
                key={c.id}
                content={c}
                isOwner
                canAssign={canAssign}
                onEdit={setEditing}
                onDelete={setDeleting}
                onShare={setSharing}
                onAssign={canAssign ? setAssigning : undefined}
                usageMetrics={usageById[c.id]}
                usageUnavailable={usageUnavailable}
                emphasizeAssign={Boolean(assignToCourse)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateContentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(content) => navigate(`/dashboard/content/${content.id}`)}
      />

      <EditContentModal
        open={!!editing}
        content={editing}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setContents((rows) =>
            rows.map((row) => (row.id === updated.id ? { ...row, ...updated, unit_count: row.unit_count } : row)),
          );
          setFeedback(t("pcChangesSaved"));
        }}
      />

      <ShareContentModal
        open={!!sharing}
        content={sharing}
        onClose={() => setSharing(null)}
        onSaved={(saved) => {
          setContents((rows) =>
            rows.map((row) =>
              row.id === saved.id ? { ...row, ...saved, unit_count: row.unit_count } : row,
            ),
          );
          setSharing(null);
          setFeedback(t("pcChangesSaved"));
        }}
      />

      <AssignLessonModal
        open={!!assigning}
        onClose={() => setAssigning(null)}
        sourceType="content"
        sourceId={assigning?.id}
        defaultTitle={assigning?.title}
        contentTitle={assigning?.title}
        contextLabel="contenido"
        defaultCourseId={assignToCourse || null}
      />

      <DeleteContentModal
        open={!!deleting}
        content={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setContents((rows) => rows.filter((row) => row.id !== id));
        }}
      />
    </PyBotClassLayout>
  );
}
