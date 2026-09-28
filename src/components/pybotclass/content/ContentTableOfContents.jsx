import { useMemo, useState } from "react";
import { t } from "../../../i18n.js";
import { deriveContentToc } from "../../../platform/contentToc.js";

function TypeIcon({ itemType, size = 14 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
  };
  switch (itemType) {
    case "video":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
        </svg>
      );
    case "exercise":
      return (
        <svg {...common}>
          <path
            d="M4 16.5V20h3.5L17.8 9.7l-3.5-3.5L4 16.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "quiz":
    case "assessment":
    case "test":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.5 12.5l1.8 1.8 3.7-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "assignment":
      return (
        <svg {...common}>
          <path
            d="M8 4.75h8A1.25 1.25 0 0 1 17.25 6v14L12 17.5 6.75 20V6A1.25 1.25 0 0 1 8 4.75Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "project":
      return (
        <svg {...common}>
          <path
            d="M3.75 8.5V18A1.25 1.25 0 0 0 5 19.25h14A1.25 1.25 0 0 0 20.25 18V9.75H10.5L8.75 7.5H5A1.25 1.25 0 0 0 3.75 8.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "resource":
      return (
        <svg {...common}>
          <path
            d="M7 4.75h7.5L19 9.25V19.5A.75.75 0 0 1 18.25 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 11h6M9 14.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "reading":
    case "theory":
    case "example":
    case "activity":
    case "lesson":
    default:
      return (
        <svg {...common}>
          <path
            d="M6.5 4.75h8.5L18.5 8.75V19a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M14.5 4.75V9H18.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
  }
}

function TocItemButton({ item, depth, onNavigate }) {
  const navType = item.kind === "lesson" ? "lesson" : "item";
  return (
    <button
      type="button"
      className={`pbc-content-toc__link${depth > 0 ? ` pbc-content-toc__link--depth-${depth}` : ""}`}
      onClick={() =>
        onNavigate?.({
          type: navType,
          id: item.id,
          unitId: item.unitId,
          parentLessonId: item.parentLessonId,
          anchor: item.anchor,
        })
      }
    >
      <span className="pbc-content-toc__type-icon" aria-hidden>
        <TypeIcon itemType={item.itemType} />
      </span>
      <span className="pbc-content-toc__num">{item.numberLabel}</span>
      <span className="pbc-content-toc__title">{item.title}</span>
      <span className="pbc-content-toc__badge">{t(`pcItemType_${item.itemType}`)}</span>
      {item.estimatedMinutes ? (
        <span className="pbc-content-toc__mins">{item.estimatedMinutes}′</span>
      ) : null}
    </button>
  );
}

/**
 * Automatic TOC from live units + top-level items + optional lesson children.
 */
export default function ContentTableOfContents({
  units,
  lessonsByUnit,
  itemsByLesson = {},
  onNavigate,
  collapsedDefault = false,
}) {
  const [open, setOpen] = useState(!collapsedDefault);
  const [collapsedUnits, setCollapsedUnits] = useState(() => new Set());
  const [collapsedLessons, setCollapsedLessons] = useState(() => new Set());
  const toc = useMemo(
    () => deriveContentToc(units, lessonsByUnit, itemsByLesson),
    [units, lessonsByUnit, itemsByLesson],
  );

  if (!toc.length) return null;

  const toggleUnit = (id) => {
    setCollapsedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLesson = (id) => {
    setCollapsedLessons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav className="pbc-content-toc" aria-label={t("pcTocTitle")}>
      <button
        type="button"
        className="pbc-content-toc__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t("pcTocTitle")}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ol className="pbc-content-toc__list">
          {toc.map((unit) => {
            const unitOpen = !collapsedUnits.has(unit.id);
            const hasChildren = Boolean(unit.children?.length);
            return (
              <li key={unit.id} className="pbc-content-toc__unit">
                <div className="pbc-content-toc__row">
                  {hasChildren ? (
                    <button
                      type="button"
                      className="pbc-content-toc__branch"
                      aria-expanded={unitOpen}
                      aria-label={unitOpen ? t("pcTocCollapse") : t("pcTocExpand")}
                      onClick={() => toggleUnit(unit.id)}
                    >
                      {unitOpen ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="pbc-content-toc__branch pbc-content-toc__branch--spacer" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="pbc-content-toc__link pbc-content-toc__link--unit"
                    onClick={() => onNavigate?.({ type: "unit", id: unit.id, anchor: unit.anchor })}
                  >
                    <span className="pbc-content-toc__num">{unit.numberLabel}.</span>
                    <span className="pbc-content-toc__title">{unit.title}</span>
                    <span className="pbc-content-toc__badge">{t(`pcUnitType_${unit.unitType}`)}</span>
                    {unit.estimatedMinutes ? (
                      <span className="pbc-content-toc__mins">{unit.estimatedMinutes}′</span>
                    ) : null}
                  </button>
                </div>
                {hasChildren && unitOpen ? (
                  <ol className="pbc-content-toc__items">
                    {unit.children.map((item) => {
                      const lessonOpen = !collapsedLessons.has(item.id);
                      const hasGrandchildren = Boolean(item.children?.length);
                      return (
                        <li key={item.id}>
                          <div className="pbc-content-toc__row">
                            {hasGrandchildren ? (
                              <button
                                type="button"
                                className="pbc-content-toc__branch"
                                aria-expanded={lessonOpen}
                                aria-label={lessonOpen ? t("pcTocCollapse") : t("pcTocExpand")}
                                onClick={() => toggleLesson(item.id)}
                              >
                                {lessonOpen ? "▾" : "▸"}
                              </button>
                            ) : (
                              <span
                                className="pbc-content-toc__branch pbc-content-toc__branch--spacer"
                                aria-hidden
                              />
                            )}
                            <TocItemButton item={item} depth={0} onNavigate={onNavigate} />
                          </div>
                          {hasGrandchildren && lessonOpen ? (
                            <ol className="pbc-content-toc__items pbc-content-toc__items--nested">
                              {item.children.map((child) => (
                                <li key={child.id}>
                                  <TocItemButton item={child} depth={1} onNavigate={onNavigate} />
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </nav>
  );
}
