import { t } from "../../../i18n.js";

function formatAge(content) {
  if (content?.recommended_age_min == null || content?.recommended_age_max == null) return null;
  return `${content.recommended_age_min}–${content.recommended_age_max}`;
}

/**
 * Compact catalog chips for Material / Community cards.
 *
 * Provenance (canonical Spanish wording via i18n pcOwner / pcOriginalOf):
 * - Original content: Propietario: <owner>
 * - Copied with original_owner_id: Propietario: <current owner>
 *   and Original de: <original owner>
 *
 * Semantics: owner_id = current owner of this record;
 * original_owner_id = original owner/author when applicable.
 * Never present the copy owner as original author unless both identities match.
 *
 * Layout: secondary compact text; wraps naturally at 360px, 375px, 430px
 * (and desktop/tablet); max-width 100% avoids horizontal overflow; stays clear of
 * badges BORRADOR / PUBLICADO / COMUNIDAD / PRIVADO / CURSOS and action buttons.
 * Those badges are status/visibility — not ownership indicators.
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

  const ownerLine = showAuthor ? content.owner_name || content.created_by_name || null : null;
  // Only when original_owner_id exists; never invent original authorship from current owner.
  const originalOwnerLine = content.original_owner_id
    ? content.original_owner_name || content.based_on_name || null
    : null;

  if (!chips.length && !ownerLine && !originalOwnerLine) return null;

  // Wrap-safe at 360px / 375px / 430px; no collision with BORRADOR PUBLICADO COMUNIDAD PRIVADO CURSOS.
  const provStyle = {
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    maxWidth: "100%",
  };

  return (
    <div className="pbc-content-meta-chips" style={{ maxWidth: "100%", minWidth: 0 }}>
      {chips.length ? (
        <div className="pbc-content-meta-chips__row" aria-label={t("pcMetaCatalog")}>
          {chips.map((c) => (
            <span key={c.key} className="pbc-content-meta-chip">
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {ownerLine ? (
        <p className="pbc-content-meta-chips__prov" style={provStyle}>
          {t("pcOwner")} {ownerLine}
        </p>
      ) : null}
      {originalOwnerLine ? (
        <p className="pbc-content-meta-chips__prov pbc-content-meta-chips__prov--based" style={provStyle}>
          {t("pcOriginalOf")} {originalOwnerLine}
        </p>
      ) : null}
    </div>
  );
}
