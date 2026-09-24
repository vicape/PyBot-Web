import { useState } from "react";
import { t } from "../../../i18n.js";
import { deriveContentToc } from "../../../platform/contentToc.js";

/**
 * Automatic TOC from live units + lessons (no stored duplicate).
 */
export default function ContentTableOfContents({
  units,
  lessonsByUnit,
  onNavigate,
  collapsedDefault = false,
}) {
  const [open, setOpen] = useState(!collapsedDefault);
  const toc = deriveContentToc(units, lessonsByUnit);

  if (!toc.length) return null;

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
          {toc.map((unit) => (
            <li key={unit.id} className="pbc-content-toc__unit">
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
              {unit.children?.length ? (
                <ol className="pbc-content-toc__items">
                  {unit.children.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="pbc-content-toc__link"
                        onClick={() =>
                          onNavigate?.({ type: "lesson", id: item.id, unitId: item.unitId, anchor: item.anchor })
                        }
                      >
                        <span className="pbc-content-toc__num">{item.numberLabel}</span>
                        <span className="pbc-content-toc__title">{item.title}</span>
                        <span className="pbc-content-toc__badge">{t(`pcItemType_${item.itemType}`)}</span>
                        {item.estimatedMinutes ? (
                          <span className="pbc-content-toc__mins">{item.estimatedMinutes}′</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </nav>
  );
}
