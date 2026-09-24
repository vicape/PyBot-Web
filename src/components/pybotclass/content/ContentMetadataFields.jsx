import { t } from "../../../i18n.js";
import {
  CONTENT_DIFFICULTIES,
  CONTENT_LANGUAGE_CODES,
} from "../../../platform/contentMetadata.js";

function listToText(arr) {
  return Array.isArray(arr) ? arr.join(", ") : "";
}

/**
 * Progressive-disclosure metadata fields for create/edit.
 */
export default function ContentMetadataFields({ value, onChange, disabled }) {
  const v = value || {};

  const set = (patch) => onChange?.({ ...v, ...patch });

  return (
    <div className="pbc-content-meta-fields">
      <div className="pbc-content-meta-fields__row">
        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="meta-language">
            {t("pcMetaLanguage")}
          </label>
          <select
            id="meta-language"
            className="pbc-input"
            value={v.language_code || ""}
            disabled={disabled}
            onChange={(e) => set({ language_code: e.target.value || null })}
          >
            <option value="">{t("pcMetaUnknown")}</option>
            {CONTENT_LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>

        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="meta-difficulty">
            {t("pcMetaDifficulty")}
          </label>
          <select
            id="meta-difficulty"
            className="pbc-input"
            value={v.difficulty || ""}
            disabled={disabled}
            onChange={(e) => set({ difficulty: e.target.value || null })}
          >
            <option value="">{t("pcMetaUnknown")}</option>
            {CONTENT_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`pcDifficulty_${d}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pbc-content-meta-fields__row">
        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="meta-age-min">
            {t("pcMetaAgeMin")}
          </label>
          <input
            id="meta-age-min"
            className="pbc-input"
            type="number"
            min={3}
            max={120}
            value={v.recommended_age_min ?? ""}
            disabled={disabled}
            onChange={(e) =>
              set({ recommended_age_min: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="meta-age-max">
            {t("pcMetaAgeMax")}
          </label>
          <input
            id="meta-age-max"
            className="pbc-input"
            type="number"
            min={3}
            max={120}
            value={v.recommended_age_max ?? ""}
            disabled={disabled}
            onChange={(e) =>
              set({ recommended_age_max: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="pbc-modal__field">
          <label className="pbc-label" htmlFor="meta-minutes">
            {t("pcMetaEstimatedMinutes")}
          </label>
          <input
            id="meta-minutes"
            className="pbc-input"
            type="number"
            min={1}
            value={v.estimated_minutes ?? ""}
            disabled={disabled}
            onChange={(e) =>
              set({ estimated_minutes: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="pbc-modal__field">
        <label className="pbc-label" htmlFor="meta-subject">
          {t("pcMetaSubject")}
        </label>
        <input
          id="meta-subject"
          className="pbc-input"
          value={v.subject || ""}
          disabled={disabled}
          onChange={(e) => set({ subject: e.target.value })}
          placeholder={t("pcMetaSubjectPlaceholder")}
        />
      </div>

      <div className="pbc-modal__field">
        <label className="pbc-label" htmlFor="meta-tags">
          {t("pcMetaTags")}
        </label>
        <input
          id="meta-tags"
          className="pbc-input"
          value={listToText(v.tags)}
          disabled={disabled}
          onChange={(e) => set({ tags: e.target.value })}
          placeholder={t("pcMetaTagsPlaceholder")}
        />
      </div>

      <div className="pbc-modal__field">
        <label className="pbc-label" htmlFor="meta-objectives">
          {t("pcMetaObjectives")}
        </label>
        <textarea
          id="meta-objectives"
          className="pbc-input pbc-input--textarea"
          rows={2}
          value={listToText(v.learning_objectives)}
          disabled={disabled}
          onChange={(e) => set({ learning_objectives: e.target.value })}
          placeholder={t("pcMetaListPlaceholder")}
        />
      </div>

      <div className="pbc-modal__field">
        <label className="pbc-label" htmlFor="meta-prereqs">
          {t("pcMetaPrerequisites")}
        </label>
        <textarea
          id="meta-prereqs"
          className="pbc-input pbc-input--textarea"
          rows={2}
          value={listToText(v.prerequisites)}
          disabled={disabled}
          onChange={(e) => set({ prerequisites: e.target.value })}
          placeholder={t("pcMetaListPlaceholder")}
        />
      </div>
    </div>
  );
}
