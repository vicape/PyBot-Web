import { t } from "../../../i18n.js";

function formatAge(content) {
  if (content?.recommended_age_min == null || content?.recommended_age_max == null) return null;
  return `${content.recommended_age_min}–${content.recommended_age_max}`;
}

/**
 * Compact catalog chips for Material / Community cards.
 */
export default function ContentMetaChips({ content, showAuthor = false }) {
  if (!content) return null;

  const chips = [];
  if (content.language_code) {
    chips.push({ key: "lang", label: content.language_code.toUpperCase() });
  }
  const age = formatAge(content);
  if (age) chips.push({ key: "age", label: `${t("pcMetaAgeShort")} ${age}` });
  if (content.estimated_minutes) {
    chips.push({ key: "mins", label: `${content.estimated_minutes} ${t("pcMetaMinShort")}` });
  }
  if (content.difficulty) {
    chips.push({ key: "diff", label: t(`pcDifficulty_${content.difficulty}`) });
  }

  const authorLine = showAuthor
    ? content.owner_name || content.created_by_name || null
    : null;
  const basedOn =
    content.copied_from_content_id || content.original_content_id
      ? content.original_owner_name || content.based_on_name || null
      : null;

  if (!chips.length && !authorLine && !basedOn && !content.copied_from_content_id) return null;

  return (
    <div className="pbc-content-meta-chips">
      {chips.length ? (
        <div className="pbc-content-meta-chips__row" aria-label={t("pcMetaCatalog")}>
          {chips.map((c) => (
            <span key={c.key} className="pbc-content-meta-chip">
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {authorLine ? (
        <p className="pbc-content-meta-chips__prov">
          {t("pcCreatedBy")} {authorLine}
        </p>
      ) : null}
      {basedOn ? (
        <p className="pbc-content-meta-chips__prov pbc-content-meta-chips__prov--based">
          {t("pcBasedOnMaterial")} {basedOn}
        </p>
      ) : content.copied_from_content_id ? (
        <p className="pbc-content-meta-chips__prov pbc-content-meta-chips__prov--based">
          {t("pcBasedOnMaterial")}
        </p>
      ) : null}
    </div>
  );
}
