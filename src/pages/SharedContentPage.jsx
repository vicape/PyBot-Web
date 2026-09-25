import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AssignedContentSnapshotViewer from "../components/content-editor/AssignedContentSnapshotViewer.jsx";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";
import ContentMetaChips from "../components/pybotclass/content/ContentMetaChips.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { t } from "../i18n.js";
import { copyLearningContent, getContent, listContentUnits, listUnitLessons, getLesson } from "../platform/contentApi.js";
import { listTeacherCoursesForAssign } from "../platform/contentAssignApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";

/**
 * Lectura sola de un contenido compartido (comunidad / cursos).
 * Ofrece: Crear una copia; Asignar tal cual (si docente).
 */
export default function SharedContentPage() {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const loginPath = `/dashboard/community/${contentId}`;
  const { user, loading: authLoading, supabase } = useRequireSession(loginPath);
  const [content, setContent] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [originalOwnerName, setOriginalOwnerName] = useState("");
  const [originalCreatorName, setOriginalCreatorName] = useState("");
  const [firstCommunityPublisherName, setFirstCommunityPublisherName] = useState("");

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

  useEffect(() => {
    if (!user || !contentId || !isSupabaseConfigured()) return;
    void (async () => {
      setLoading(true);
      const [{ profile }, teacherCourses] = await Promise.all([
        fetchProfile(user.id),
        listTeacherCoursesForAssign(),
      ]);
      setSuperAdmin(isSuperAdmin(profile));
      setCanAssign((teacherCourses.rows || []).length > 0);

      const { content: c, error } = await getContent(contentId);
      if (error || !c) {
        setErr(error || t("pcContentOpenFail"));
        setLoading(false);
        return;
      }
      if (c.owner_id === user.id) {
        navigate(`/dashboard/content/${contentId}`, { replace: true });
        return;
      }
      setContent(c);

      if (supabase) {
        const ids = [
          c.owner_id,
          c.original_owner_id,
          c.original_creator_id,
          c.first_community_published_by_id,
        ].filter(Boolean);
        if (ids.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, display_name, email")
            .in("id", ids);
          const map = {};
          for (const p of profs ?? []) map[p.id] = p.display_name || p.email || t("pcTeacherFallback");
          setOwnerName(map[c.owner_id] || "");
          if (c.original_owner_id) setOriginalOwnerName(map[c.original_owner_id] || "");
          if (c.original_creator_id) setOriginalCreatorName(map[c.original_creator_id] || "");
          if (c.first_community_published_by_id) {
            setFirstCommunityPublisherName(map[c.first_community_published_by_id] || "");
          }
        }
      }

      const { rows: unitRows } = await listContentUnits(contentId);
      const unitSnaps = [];
      for (const u of unitRows) {
        const { rows: lessons } = await listUnitLessons(u.id);
        const lessonSnaps = [];
        for (const l of lessons) {
          const { lesson } = await getLesson(l.id);
          lessonSnaps.push({
            id: l.id,
            title: l.title,
            description: l.description || "",
            position: l.position,
            itemType: l.item_type || "lesson",
            estimatedMinutes: l.estimated_minutes ?? null,
            document_json: Array.isArray(lesson?.document_json) ? lesson.document_json : [],
          });
        }
        unitSnaps.push({
          id: u.id,
          title: u.title,
          description: u.description || "",
          position: u.position,
          unitType: u.unit_type || "unit",
          estimatedMinutes: u.estimated_minutes ?? null,
          lessons: lessonSnaps,
        });
      }
      setSnapshot({
        schemaVersion: 2,
        sourceType: "content",
        sourceId: c.id,
        title: c.title,
        description: c.description || "",
        units: unitSnaps,
      });
      setLoading(false);
    })();
  }, [user, contentId, navigate, supabase]);

  const handleCopy = async () => {
    if (busy || !contentId) return;
    setBusy(true);
    setErr("");
    const { content: copy, error } = await copyLearningContent(contentId);
    setBusy(false);
    if (error || !copy) {
      setErr(error === "forbidden_read" ? t("pcCopyFail") : error || t("pcCopyFail"));
      return;
    }
    navigate(`/dashboard/content/${copy.id}`);
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
      {err ? (
        <div className="pbc-alert pbc-alert--error" role="alert">
          {err}
        </div>
      ) : null}
      <div className="pbc-content-editor pbc-shared-content">
        <nav className="pbc-content-breadcrumb" aria-label={t("pcRoute")}>
          <Link to="/dashboard/community">{t("pcCommunity")}</Link>
          <span aria-hidden> › </span>
          <span>{content?.title || t("pcNavContent")}</span>
        </nav>
        <header className="pbc-content-editor__head">
          <div className="pbc-shared-content__banner" role="status">
            {t("pcReadOnlyShared")}
          </div>
          <h1 className="pbc-hero-block__title">{content?.title}</h1>
          <ContentMetaChips
            content={{
              ...content,
              owner_name: ownerName,
              original_owner_name: originalOwnerName,
              original_creator_name: originalCreatorName || originalOwnerName,
              first_community_published_by_name: firstCommunityPublisherName,
              based_on_name: originalOwnerName,
            }}
            showAuthor
          />
          <div className="pbc-content-editor__actions">
            <button type="button" className="pbc-btn pbc-btn--primary" disabled={busy} onClick={() => void handleCopy()}>
              {busy ? t("pcCopying") : t("pcCreateCopy")}
            </button>
            {canAssign ? (
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost"
                disabled={busy}
                onClick={() => setAssignOpen(true)}
              >
                {t("pcAssignAsIs")}
              </button>
            ) : null}
          </div>
        </header>

        <AssignedContentSnapshotViewer snapshot={snapshot} />
      </div>

      <AssignLessonModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        sourceType="content"
        sourceId={contentId}
        defaultTitle={content?.title}
        contentTitle={content?.title}
        contextLabel="contenido"
      />
    </PyBotClassLayout>
  );
}
