import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ContentMetaChips from "../components/pybotclass/content/ContentMetaChips.jsx";
import PyBotClassLayout from "../components/pybotclass/layout/PyBotClassLayout.jsx";
import { t } from "../i18n.js";
import { copyLearningContent, listMyContents } from "../platform/contentApi.js";
import { listTeacherCoursesForAssign } from "../platform/contentAssignApi.js";
import {
  getMyContentUsageMetrics,
  listCommunityContents,
} from "../platform/contentShareApi.js";
import { fetchProfile } from "../platform/profileApi.js";
import { useRequireSession } from "../platform/useRequireSession.js";
import { isSupabaseConfigured } from "../supabaseClient.js";
import { isSuperAdmin } from "../platformRole.js";
import AssignLessonModal from "../components/content-editor/AssignLessonModal.jsx";
import ShareContentModal from "../components/content-editor/ShareContentModal.jsx";

const VIEW_MINE = "mine";
const VIEW_EXPLORE = "explore";

/** AC3: visibility = community | visibility = courses | visibility = private */
function visibilityBadgeLabel(visibility) {
  if (visibility === "community") return t("pcSharedInCommunity"); // Compartido en Comunidad
  if (visibility === "courses") return t("pcMyCourses");
  return t("pcPrivate"); // visibility = private
}

/**
 * AC25: cards/usage wrap cleanly at desktop, tablet, 430px, 375px, 360px.
 * AC2: Mi contenido must show ALL content owned by the logged-in user (not only community).
 * AC17: search only the current user’s owned content; in Explorar comunidad only others.
 * AC21: Usado actualmente por N docentes / N crearon una copia / N lo asignaron directamente.
 */

function ownedShowProvenance(content, userId) {
  if (!content) return false;
  if (content.copied_from_content_id) return true;
  if (content.original_creator_id && content.original_creator_id !== userId) return true;
  if (content.first_community_published_by_id && content.first_community_published_by_id !== userId) {
    return true;
  }
  if (content.original_owner_id && content.original_owner_id !== userId) return true;
  return false;
}

function UsageBlock({ metrics, unavailable }) {
  const wrap = {
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    maxWidth: "100%",
    margin: "0.35rem 0 0",
    fontSize: "0.85rem",
    opacity: 0.9,
  };

  if (unavailable) {
    return <p style={wrap}>{t("pcUsageUnavailable")}</p>;
  }

  const total = metrics?.distinct_total_user_count ?? 0;
  if (total <= 0) {
    return <p style={wrap}>{t("pcUsageNobody")}</p>;
  }

  const copyN = metrics?.distinct_copy_user_count ?? 0;
  const assignN = metrics?.distinct_assignment_user_count ?? 0;

  return (
    <div style={wrap}>
      <p style={{ margin: 0 }}>{t("pcUsageUsedBy").replace("{n}", String(total))}</p>
      {copyN > 0 ? (
        <p style={{ margin: "0.15rem 0 0" }}>
          {t("pcUsageCopyBreakdown").replace("{n}", String(copyN))}
        </p>
      ) : null}
      {assignN > 0 ? (
        <p style={{ margin: "0.15rem 0 0" }}>
          {t("pcUsageAssignBreakdown").replace("{n}", String(assignN))}
        </p>
      ) : null}
    </div>
  );
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, profileError, supabase } = useRequireSession("/dashboard/community");
  const [view, setView] = useState(VIEW_MINE);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [canAssign, setCanAssign] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [copyBusyId, setCopyBusyId] = useState(null);
  const [usageById, setUsageById] = useState({});
  const [usageUnavailable, setUsageUnavailable] = useState(false);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

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

  const load = useCallback(
    async (activeView, term) => {
      setLoading(true);
      setErr("");
      const q = String(term || "").trim();

      if (activeView === VIEW_MINE) {
        const [{ rows: list, error }, ] = await Promise.all([
          listMyContents(),
          loadUsage(),
        ]);
        setLoading(false);
        if (error) {
          setErr(error);
          setRows([]);
          return;
        }
        const filtered = q
          ? (list || []).filter((r) => String(r.title || "").toLowerCase().includes(q.toLowerCase()))
          : list || [];
        setRows(filtered);
        return;
      }

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
    [loadUsage, user?.id],
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
      await load(view, "");
    })();
    // initial bootstrap only when user becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const switchView = (next) => {
    if (next === view) return;
    setView(next);
    setSearch("");
    void load(next, "");
  };

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

  const tabs = [
    { id: VIEW_MINE, label: t("pcCommunityTabMine") },
    { id: VIEW_EXPLORE, label: t("pcCommunityTabExplore") },
  ];

  return (
    <PyBotClassLayout user={user} showAdmin={superAdmin} onSignOut={() => void signOut()}>
      {profileError ? <p className="pbc-alert pbc-alert--error">{profileError}</p> : null}
      {err ? <p className="pbc-alert pbc-alert--error">{err}</p> : null}

      <header className="pbc-hero-block" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 className="pbc-hero-block__title">Comunidad PyBot</h1>
          <p className="pbc-hero-block__lead">
            Contenidos que docentes compartieron para lectura. Solo el autor puede editarlos.
          </p>
        </div>
      </header>

      <div
        className="pbc-filter-tabs"
        role="tablist"
        aria-label={t("pcCommunity")}
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, maxWidth: "100%" }}
      >
        {tabs.map((tab) => {
          const selected = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`pbc-filter-tab${selected ? " pbc-filter-tab--active" : ""}`}
              onClick={() => switchView(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <form
        className="pbc-community-search"
        onSubmit={(e) => {
          e.preventDefault();
          void load(view, search);
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
        <p className="pbc-modal--assign-lesson__subtitle">
          {view === VIEW_MINE ? t("pcCommunityEmptyMine") : t("pcCommunityEmptyExplore")}
        </p>
      ) : (
        <div className="pbc-content-grid">
          {view === VIEW_MINE
            ? rows.map((c) => (
                <article key={c.id} className="pbc-content-card" style={{ minWidth: 0, maxWidth: "100%" }}>
                  <div className="pbc-content-card__header">
                    <span className="pbc-badge pbc-badge--blue">{visibilityBadgeLabel(c.visibility)}</span>
                  </div>
                  <h2 className="pbc-content-card__title">{c.title}</h2>
                  {c.description ? <p className="pbc-content-card__desc">{c.description}</p> : null}
                  <ContentMetaChips
                    content={{
                      ...c,
                      based_on_name: c.original_owner_name,
                    }}
                    showAuthor={ownedShowProvenance(c, user.id)}
                  />
                  <UsageBlock metrics={usageById[c.id]} unavailable={usageUnavailable} />
                  <div
                    className="pbc-content-card__actions-row"
                    style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: "100%" }}
                  >
                    <Link to={`/dashboard/content/${c.id}`} className="pbc-content-card__link">
                      {t("pcOpen")} →
                    </Link>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={() => navigate(`/dashboard/content/${c.id}`)}
                    >
                      {t("pcEdit")}
                    </button>
                    <button
                      type="button"
                      className="pbc-btn pbc-btn--ghost pbc-btn--sm"
                      onClick={() => setSharing(c)}
                    >
                      {t("pcManageSharing")}
                    </button>
                  </div>
                </article>
              ))
            : rows.map((c) => (
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

      <ShareContentModal
        open={!!sharing}
        content={sharing}
        onClose={() => setSharing(null)}
        onSaved={(saved) => {
          setRows((prev) =>
            prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)),
          );
          setSharing(null);
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
      />
    </PyBotClassLayout>
  );
}
