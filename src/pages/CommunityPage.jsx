import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ContentMetaChips from "../components/pybotclass/content/ContentMetaChips.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { t } from "../i18n.js";
import { copyLearningContent } from "../platform/contentApi.js";
import { listTeacherCoursesForAssign } from "../platform/contentAssignApi.js";
import { listCommunityContents } from "../platform/contentShareApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";

/**
 * Community = other teachers' shared material only.
 * Own-content management lives on /dashboard/content.
 */

export default function CommunityPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/community");
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [copyBusyId, setCopyBusyId] = useState(null);
  const [feedback, setFeedback] = useState("");

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

  const load = useCallback(
    async (term) => {
      setLoading(true);
      setErr("");
      const q = String(term || "").trim();
      const { rows: list, error } = await listCommunityContents({
        search: q,
        excludeOwnerId: user?.id,
      });
      setLoading(false);
      if (error) {
        setErr(error);
        setRows([]);
        return;
      }
      setRows(list || []);
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;
    void (async () => {
      const [{ profile }, teacherCourses] = await Promise.all([
        fetchProfile(user.id),
        listTeacherCoursesForAssign(),
      ]);
      setSuperAdmin(isSuperAdmin(profile));
      setCanAssign((teacherCourses.rows || []).length > 0);
      await load("");
    })();
  }, [user, load]);

  const handleCopy = async (c) => {
    if (!c?.id || copyBusyId) return;
    setCopyBusyId(c.id);
    setErr("");
    const { content: copy, error } = await copyLearningContent(c.id);
    setCopyBusyId(null);
    if (error || !copy) {
      setErr(error || t("pcCopyFail"));
      return;
    }
    setFeedback(t("pcCopyOk"));
    navigate(`/dashboard/content/${copy.id}`);
  };

  if (authLoading) {
    return (
      <main className="dash-root dash-root--center">
        <p>{t("pcLoadingGeneric")}</p>
      </main>
    );
  }
  if (!user) return null;

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} onSignOut={() => void signOut()}>
      {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}
      {feedback ? (
        <p className="pbc-feedback" role="status">
          {feedback}
        </p>
      ) : null}

      <header className="pbc-hero-block" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 className="pbc-hero-block__title">{t("pcCommunity")}</h1>
          <p className="pbc-hero-block__lead">{t("pcCommunityExternalLead")}</p>
        </div>
      </header>

      <form
        className="pbc-community-search"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", maxWidth: "100%" }}
      >
        <input
          className="pbc-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pcCommunitySearchPlaceholder")}
          aria-label={t("pcCommunitySearchLabel")}
          style={{ minWidth: 0, flex: "1 1 160px", maxWidth: "100%" }}
        />
        <button type="submit" className="pbc-btn pbc-btn--primary">
          {t("pcCommunitySearchButton")}
        </button>
      </form>

      {loading ? (
        <p>{t("pcLoadingGeneric")}</p>
      ) : rows.length === 0 ? (
        <p className="pbc-modal--assign-lesson__subtitle">{t("pcCommunityEmptyExplore")}</p>
      ) : (
        <div className="pbc-content-grid">
          {rows.map((c) => (
            <article key={c.id} className="pbc-content-card" style={{ minWidth: 0, maxWidth: "100%" }}>
              <div className="pbc-content-card__header">
                <span className="pbc-badge pbc-badge--blue">{t("pcCommunity")}</span>
              </div>
              <h2 className="pbc-content-card__title">{c.title}</h2>
              {c.description ? <p className="pbc-content-card__desc">{c.description}</p> : null}
              <ContentMetaChips
                content={{
                  ...c,
                  based_on_name: c.original_owner_name,
                }}
                showAuthor
              />
              <div
                className="pbc-content-card__actions-row"
                style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: "100%" }}
              >
                <Link to={`/dashboard/community/${c.id}`} className="pbc-content-card__link">
                  {t("pcRead")} →
                </Link>
                <button
                  type="button"
                  className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                  disabled={copyBusyId === c.id}
                  onClick={() => void handleCopy(c)}
                >
                  {copyBusyId === c.id ? t("pcCopying") : t("pcCreateCopy")}
                </button>
                {canAssign ? (
                  <button
                    type="button"
                    className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                    onClick={() => setAssigning(c)}
                  >
                    {t("pcAssignAsIs")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <AssignLessonModal
        open={!!assigning}
        onClose={() => setAssigning(null)}
        sourceType="content"
        sourceId={assigning?.id}
        defaultTitle={assigning?.title}
        contentTitle={assigning?.title}
        contextLabel="contenido"
      />
    </PyBotClassLayout>
  );
}
