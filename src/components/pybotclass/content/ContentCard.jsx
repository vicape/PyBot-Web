import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CONTENT_STATUS_LABELS } from "../../../platform/contentApi.js";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function ContentCard({ content, onEdit, onDelete, onShare, onAssign }) {
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
            {CONTENT_STATUS_LABELS[content.status] || "Borrador"}
          </span>
          {content.visibility && content.visibility !== "private" ? (
            <span className="pbc-badge pbc-badge--blue" title="Visibilidad">
              {content.visibility === "community"
                ? "Comunidad"
                : content.visibility === "courses"
                  ? "Cursos"
                  : "Privado"}
            </span>
          ) : null}

          <div className="pbc-content-card__menu" ref={menuRef}>
            <button
              type="button"
              className="pbc-content-card__menu-btn"
              aria-label="Más opciones"
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
                  Compartir
                </button>
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
                  Asignar
                </button>
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 16.5V20h3.5L17.8 9.7l-3.5-3.5L4 16.5Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M13.2 5.3l3.5 3.5 1.8-1.8a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0l-1.8 1.8Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Editar
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M5 7.5h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path
                      d="M9.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 6v1.5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path
                      d="M8 7.5l.7 11a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-11"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Eliminar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <h2 className="pbc-content-card__title">{content.title}</h2>
      {content.description ? <p className="pbc-content-card__desc">{content.description}</p> : null}
      <div className="pbc-content-card__meta">
        <span>
          {content.unit_count} unidad{content.unit_count === 1 ? "" : "es"}
        </span>
        <span>Modificado {formatDate(content.updated_at)}</span>
      </div>
      <Link to={`/dashboard/content/${content.id}`} className="pbc-content-card__link">
        Abrir →
      </Link>
    </article>
  );
}
