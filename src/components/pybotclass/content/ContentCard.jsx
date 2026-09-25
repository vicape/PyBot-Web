import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLang, t } from "../../../i18n.js";
import { ownedContentShareState } from "../../../platform/uxIaHelpers.js";
import {
  IconAssign,
  IconContentType,
  IconCopy,
  IconDraft,
  IconEdit,
  IconLock,
  IconOpen,
  IconPublished,
  IconShare,
  IconSharedCommunity,
  IconSharedCourses,
} from "../illustrations/ActionIcons.jsx";
import ContentMetaChips from "./ContentMetaChips.jsx";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(
      { es: "es-AR", en: "en-US", fr: "fr-FR", pt: "pt-BR", de: "de-DE" }[getLang()] || "es-AR",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  } catch {
    return "";
  }
}

function shareBadgeLabel(visibility) {
  const state = ownedContentShareState(visibility);
  if (state === "community") return t("pcSharedInCommunity");
  if (state === "courses") return t("pcSharedToCourses");
  return t("pcPrivate");
}

function ShareBadgeIcon({ visibility }) {
  const state = ownedContentShareState(visibility);
  if (state === "community") return <IconSharedCommunity />;
  if (state === "courses") return <IconSharedCourses />;
  return <IconLock size={12} />;
}

function UsageBlock({ metrics, unavailable }) {
  if (unavailable) {
    return (
      <p className="pbc-content-card__usage pbc-content-card__usage--muted" title={t("pcUsageUnavailable")}>
        {t("pcUsageUnavailable")}
      </p>
    );
  }

  const total = metrics?.distinct_total_user_count ?? 0;
  if (total <= 0) {
    return <p className="pbc-content-card__usage">{t("pcUsageNobody")}</p>;
  }

  const copyN = metrics?.distinct_copy_user_count ?? 0;
  const assignN = metrics?.distinct_assignment_user_count ?? 0;

  return (
    <div className="pbc-content-card__usage">
      <p className="pbc-content-card__usage-line">{t("pcUsageUsedBy").replace("{n}", String(total))}</p>
      {copyN > 0 ? (
        <p className="pbc-content-card__usage-line">
          {t("pcUsageCopyBreakdown").replace("{n}", String(copyN))}
        </p>
      ) : null}
      {assignN > 0 ? (
        <p className="pbc-content-card__usage-line">
          {t("pcUsageAssignBreakdown").replace("{n}", String(assignN))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * @param {{
 *   content: object,
 *   isOwner?: boolean,
 *   canAssign?: boolean,
 *   onEdit?: Function,
 *   onDelete?: Function,
 *   onShare?: Function,
 *   onAssign?: Function,
 *   onCopy?: Function,
 *   usageMetrics?: object | null,
 *   usageUnavailable?: boolean,
 *   emphasizeAssign?: boolean,
 * }} props
 */
export default function ContentCard({
  content,
  isOwner = true,
  canAssign = false,
  onEdit,
  onDelete,
  onShare,
  onAssign,
  onCopy,
  usageMetrics = null,
  usageUnavailable = false,
  emphasizeAssign = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  // Own original content: do not emphasize Create Copy unless caller needs it.
  const showCopy = Boolean(onCopy) && !isOwner;
  const showDirectAssign = canAssign && Boolean(onAssign);
  // Menu keeps secondary actions; Assign stays in menu only when not shown directly.
  const showMenu = isOwner || showCopy || (canAssign && !showDirectAssign);

  return (
    <article className="pbc-content-card" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
      <div className="pbc-content-card__header">
        <span className="pbc-content-card__icon" aria-hidden>
          <IconContentType />
        </span>

        <div className="pbc-content-card__header-right">
          <span className="pbc-badge pbc-badge--blue pbc-badge--with-icon">
            <span aria-hidden>
              {content.status === "published" ? <IconPublished size={12} /> : <IconDraft size={12} />}
            </span>
            {content.status === "published" ? t("pcPublished") : t("pcDraft")}
          </span>
          {isOwner ? (
            <span className="pbc-badge pbc-badge--blue pbc-badge--with-icon" title={t("pcVisibility")}>
              <span aria-hidden>
                <ShareBadgeIcon visibility={content.visibility} />
              </span>
              {shareBadgeLabel(content.visibility)}
            </span>
          ) : content.visibility && content.visibility !== "private" ? (
            <span className="pbc-badge pbc-badge--blue pbc-badge--with-icon">
              <span aria-hidden>
                {content.visibility === "community" ? (
                  <IconSharedCommunity />
                ) : (
                  <IconSharedCourses />
                )}
              </span>
              {content.visibility === "community" ? t("pcCommunity") : t("pcCourses")}
            </span>
          ) : null}

          {showMenu ? (
            <div className="pbc-content-card__menu" ref={menuRef}>
              <button
                type="button"
                className="pbc-content-card__menu-btn"
                aria-label={t("pcMoreOptions")}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="5" cy="12" r="1.75" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.75" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.75" fill="currentColor" />
                </svg>
              </button>

              {menuOpen ? (
                <div className="pbc-content-card__menu-panel" role="menu">
                  {isOwner ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="pbc-content-card__menu-item"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        onShare?.(content);
                      }}
                    >
                      <span aria-hidden>
                        <IconShare size={16} />
                      </span>
                      {t("pcManageSharing")}
                    </button>
                  ) : null}
                  {canAssign && !showDirectAssign ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="pbc-content-card__menu-item"
                      title={`${t("pcAssign")} — no ownership`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        onAssign?.(content);
                      }}
                    >
                      <span aria-hidden>
                        <IconAssign size={16} />
                      </span>
                      {t("pcAssign")}
                    </button>
                  ) : null}
                  {showCopy ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="pbc-content-card__menu-item"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        onCopy?.(content);
                      }}
                    >
                      <span aria-hidden>
                        <IconCopy size={16} />
                      </span>
                      {t("pcCreateCopy")}
                    </button>
                  ) : null}
                  {isOwner ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="pbc-content-card__menu-item"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuOpen(false);
                          onEdit?.(content);
                        }}
                      >
                        <span aria-hidden>
                          <IconEdit size={16} />
                        </span>
                        {t("pcEdit")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="pbc-content-card__menu-item pbc-content-card__menu-item--danger"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuOpen(false);
                          onDelete?.(content);
                        }}
                      >
                        {t("pcDelete")}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <h2 className="pbc-content-card__title">{content.title}</h2>
      {content.description ? <p className="pbc-content-card__desc">{content.description}</p> : null}
      <div className="pbc-content-card__meta">
        <span>
          {content.unit_count ?? 0} {t("pcUnits")}
        </span>
        <span>
          {t("pcModified")} {formatDate(content.updated_at)}
        </span>
      </div>
      <ContentMetaChips content={content} showAuthor={Boolean(content.owner_name) && !isOwner} />
      {isOwner ? <UsageBlock metrics={usageMetrics} unavailable={usageUnavailable} /> : null}
      <div className="pbc-content-card__actions-row pbc-content-card__direct-actions">
        <Link to={`/dashboard/content/${content.id}`} className="pbc-content-card__link">
          <span aria-hidden>
            <IconOpen size={16} />
          </span>
          {t("pcOpen")}
        </Link>
        {showDirectAssign ? (
          <button
            type="button"
            className={`pbc-btn pbc-btn--sm ${emphasizeAssign ? "pbc-btn--primary" : "pbc-btn--ghost"}`}
            onClick={() => onAssign?.(content)}
          >
            <span aria-hidden>
              <IconAssign size={16} />
            </span>
            {t("pcAssign")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
