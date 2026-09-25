import { getLang, t } from "../../../i18n.js";

function formatAge(content) {
  if (content?.recommended_age_min == null || content?.recommended_age_max == null) return null;
  return `${content.recommended_age_min}–${content.recommended_age_max}`;
}

function formatProvDate(iso) {
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
 * Compact catalog chips for Material / Community cards.
 *
 * Provenance (canonical Spanish wording via i18n):
 * - Creado originalmente por: <creator>
 * - Compartido originalmente en PyBot por: <publisher> · <date>
 *   or Compartido originalmente en PyBot: dato histórico no disponible
 * - Propietario actual: <owner>
 *
 * Semantics (never inferred from BORRADOR / COMUNIDAD / Asignar):
 * - original_creator_id = root human creator of the lineage
 * - first_community_published_by_id / _at = first known Community publication of the lineage
 * - owner_id = current owner of this content record
 *
 * Layout: secondary compact text; wraps naturally at 360px, 375px, 430px
 * (and desktop/tablet); max-width 100% avoids horizontal overflow.
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

  const isCopy = Boolean(
    content.copied_from_content_id || content.original_content_id || content.original_owner_id,
  );
  // Prefer authoritative original_creator; fall back only to proven original_owner / owner for originals.
  const creatorLine = showAuthor
    ? content.original_creator_name ||
      content.original_owner_name ||
      content.based_on_name ||
      (!isCopy ? content.owner_name || content.created_by_name || null : null)
    : null;
  const ownerLine = showAuthor ? content.owner_name || content.created_by_name || null : null;
  const publisherName = showAuthor
    ? content.first_community_published_by_name || null
    : null;
  const publisherAt = showAuthor ? content.first_community_published_at || null : null;
  const hasPublisher = Boolean(content.first_community_published_by_id && publisherName);
  const showCommunityLine = showAuthor && (creatorLine || ownerLine);

  if (!chips.length && !creatorLine && !ownerLine && !showCommunityLine) return null;

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
      {creatorLine ? (
        <p className="pbc-content-meta-chips__prov" style={provStyle}>
          {t("pcOriginallyCreatedBy")} {creatorLine}
        </p>
      ) : null}
      {showCommunityLine ? (
        hasPublisher ? (
          <p className="pbc-content-meta-chips__prov" style={provStyle}>
            {t("pcOriginallySharedInPyBotBy")} {publisherName}
            {publisherAt ? ` · ${formatProvDate(publisherAt)}` : ""}
          </p>
        ) : (
          <p className="pbc-content-meta-chips__prov pbc-content-meta-chips__prov--based" style={provStyle}>
            {t("pcOriginallySharedInPyBotUnknown")}
          </p>
        )
      ) : null}
      {ownerLine ? (
        <p className="pbc-content-meta-chips__prov" style={provStyle}>
          {t("pcOwner")} {ownerLine}
        </p>
      ) : null}
    </div>
  );
}
