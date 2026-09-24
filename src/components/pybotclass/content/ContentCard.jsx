import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLang, t } from "../../../i18n.js";
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

  const showMenu = isOwner || canAssign || onCopy;

  return (
    <article className="pbc-content-card">
      <div className="pbc-content-card__header">
        <span className="pbc-content-card__icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5.5 7.5h13A1.5 1.5 0 0 1 20 9v10.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5V9A1.5 1.5 0 0 1 5.5 7.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M8 12h8M8 15.5h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>

        <div className="pbc-content-card__header-right">
          <span className="pbc-badge pbc-badge--blue">
            {content.status === "published" ? t("pcPublished") : t("pcDraft")}
          </span>
          {content.visibility && content.visibility !== "private" ? (
            <span className="pbc-badge pbc-badge--blue" title={t("pcVisibility")}>
              {content.visibility === "community"
                ? t("pcCommunity")
                : content.visibility === "courses"
                  ? t("pcCourses")
                  : t("pcPrivate")}
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
                      {t("pcShare")}
                    </button>
                  ) : null}
                  {canAssign ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="pbc-content-card__menu-item"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        onAssign?.(content);
                      }}
                    >
                      {t("pcAssign")}
                    </button>
                  ) : null}
                  {onCopy ? (
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
      <ContentMetaChips content={content} showAuthor={Boolean(content.owner_name)} />
      <div className="pbc-content-card__meta">
        <span>
          {content.unit_count ?? 0} {t("pcUnits")}
        </span>
        <span>
          {t("pcModified")} {formatDate(content.updated_at)}
        </span>
      </div>
      <Link to={`/dashboard/content/${content.id}`} className="pbc-content-card__link">
        {t("pcOpen")} →
      </Link>
    </article>
  );
}
