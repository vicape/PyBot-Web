/**
 * Compact Evaluación section for ActivityForm / ActivityPage.
 * One overlay for pick/create; one-off expands inline; Ver expands inline.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n.js";
import {
  getRubricTemplate,
  listMyRubricTemplates,
  upsertRubricTemplate,
} from "../../platform/activitySubmissions.js";
import {
  criteriaPayloadFromEditor,
  emptyEvaluationSelection,
  selectionFromTemplate,
  selectionMaxPointsEffect,
} from "../../platform/activityEvaluation.js";
import { rubricPointsCeiling } from "../../platform/rubrics.js";
import {
  IconAssign,
  IconCopy,
  IconEye,
  IconHash,
  IconLevels,
  IconPlus,
  IconRubricMatrix,
  IconSearch,
  IconSwap,
  IconTrash,
} from "./illustrations/ActionIcons.jsx";
import {
  RubricCriteriaEditor,
  RubricTemplateAuthoringForm,
  defaultRubricEditorState,
} from "./ActivityRubricPanels.jsx";

function modeLabel(scoringMode) {
  return scoringMode === "qualitative" ? t("pcRubricModeQualitative") : t("pcRubricModePoints");
}

function criteriaCountLabel(n) {
  return t("pcRubricCriteriaCount").replace("{n}", String(n));
}

function ReadOnlyRubricPreview({ criteria = [], scoringMode = "points" }) {
  const isPoints = scoringMode === "points";
  return (
    <div className="pbc-eval-preview" role="region" aria-label={t("pcCriteria")}>
      {(criteria || []).map((c, cIdx) => (
        <article key={c.id || `preview-c-${cIdx}`} className="pbc-eval-preview__criterion">
          <h4 className="pbc-eval-preview__name">{c.name || t("pcRubricCriterionPlaceholder")}</h4>
          {c.description ? <p className="pbc-eval-preview__desc">{c.description}</p> : null}
          <ul className="pbc-eval-preview__levels">
            {(c.levels || []).map((lv, lIdx) => (
              <li key={lv.id || `preview-l-${cIdx}-${lIdx}`} className="pbc-eval-preview__level">
                <span className="pbc-eval-preview__level-name">{lv.name}</span>
                {lv.descriptor ? (
                  <span className="pbc-eval-preview__level-desc">{lv.descriptor}</span>
                ) : null}
                {isPoints && lv.points != null && lv.points !== "" ? (
                  <span className="pbc-eval-preview__level-pts">{lv.points}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function RubricPickerOverlay({
  open,
  overlayMode,
  onOverlayModeChange,
  search,
  onSearchChange,
  templates,
  loading,
  busy,
  onClose,
  onUse,
  onCreateSave,
  createForm,
  onCreateFormChange,
}) {
  const filtered = useMemo(() => {
    const q = String(search || "")
      .trim()
      .toLowerCase();
    if (!q) return templates;
    return (templates || []).filter((row) => {
      const hay = `${row.name || ""} ${row.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  if (!open) return null;

  return (
    <div
      className="pbc-modal-backdrop pbc-eval-overlay-backdrop"
      role="presentation"
      onClick={() => !busy && onClose?.()}
    >
      <div
        className="pbc-modal pbc-modal--create-content pbc-eval-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eval-pick-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="eval-pick-title" className="pbc-modal__title">
          {t("pcChooseRubric")}
        </h2>

        {overlayMode === "create" ? (
          <div className="pbc-eval-overlay__create">
            <RubricTemplateAuthoringForm
              name={createForm.name}
              onNameChange={(name) => onCreateFormChange?.({ ...createForm, name })}
              description={createForm.description}
              onDescriptionChange={(description) =>
                onCreateFormChange?.({ ...createForm, description })
              }
              scoringMode={createForm.scoringMode}
              onScoringModeChange={(scoringMode) => {
                onCreateFormChange?.({
                  ...createForm,
                  scoringMode,
                  criteria: (createForm.criteria || []).map((c) => ({
                    ...c,
                    levels: (c.levels || []).map((lv) => ({
                      ...lv,
                      points: scoringMode === "points" ? lv.points ?? "" : null,
                    })),
                  })),
                });
              }}
              criteria={createForm.criteria}
              onCriteriaChange={(criteria) => onCreateFormChange?.({ ...createForm, criteria })}
              busy={busy}
              onSave={() => void onCreateSave?.()}
              onCancel={() => onOverlayModeChange?.("pick")}
              saveLabel={t("pcCreateRubric")}
            />
          </div>
        ) : (
          <>
            <div className="pbc-eval-overlay__toolbar">
              <label className="pbc-eval-overlay__search">
                <span className="pbc-eval-overlay__search-icon" aria-hidden>
                  <IconSearch size={18} />
                </span>
                <input
                  type="search"
                  className="auth-org-input auth-org-input--block"
                  value={search}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder={t("pcSearchRubrics")}
                  disabled={busy || loading}
                />
              </label>
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                disabled={busy}
                onClick={() => onOverlayModeChange?.("create")}
              >
                <IconPlus size={18} />
                <span>{t("pcCreateNew")}</span>
              </button>
            </div>

            {loading ? (
              <p className="auth-card__muted" role="status">
                {t("pcLoadingGeneric")}
              </p>
            ) : filtered.length === 0 ? (
              <p className="auth-card__muted">
                {t("pcRubricNoTemplatesYet")}{" "}
                <Link to="/dashboard/rubrics" className="auth-link">
                  {t("pcManageRubrics")}
                </Link>
              </p>
            ) : (
              <ul className="pbc-eval-picker-list">
                {filtered.map((row) => {
                  const count =
                    typeof row.criteria_count === "number"
                      ? row.criteria_count
                      : Array.isArray(row.criteria)
                        ? row.criteria.length
                        : null;
                  const isPoints = row.scoring_mode !== "qualitative";
                  return (
                    <li
                      key={row.id}
                      className={`pbc-eval-picker-card${
                        /* selected state via border only when parent marks — reserved */
                        ""
                      }`}
                    >
                      <div className="pbc-eval-picker-card__body">
                        <div className="pbc-eval-picker-card__icon" aria-hidden>
                          {isPoints ? <IconHash size={18} /> : <IconLevels size={18} />}
                        </div>
                        <div className="pbc-eval-picker-card__text">
                          <h3 className="pbc-eval-picker-card__name">{row.name}</h3>
                          <p className="pbc-eval-picker-card__meta">
                            {modeLabel(row.scoring_mode)}
                            {typeof count === "number" ? ` · ${criteriaCountLabel(count)}` : ""}
                          </p>
                          {row.description ? (
                            <p className="pbc-eval-picker-card__desc">{row.description}</p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-eval-btn-with-icon"
                        disabled={busy}
                        onClick={() => void onUse?.(row)}
                      >
                        <IconAssign size={18} />
                        <span>{t("pcUse")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {overlayMode !== "create" ? (
          <div className="pbc-modal__actions">
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost"
              disabled={busy}
              onClick={() => onClose?.()}
            >
              {t("pcCancel")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {{
 *   value: object,
 *   onChange: (next: object) => void,
 *   onMaxPointsEffect?: (effect: object) => void,
 *   disabled?: boolean,
 *   hasEvaluations?: boolean,
 *   showManageLink?: boolean,
 *   showMaxPointsField?: boolean,
 *   maxPoints?: string,
 *   onMaxPointsChange?: (next: string) => void,
 *   maxLocked?: boolean,
 *   maxHint?: string | null,
 *   compact?: boolean,
 *   embedded?: boolean,
 * }} props
 */
export default function ActivityEvaluationSection({
  value,
  onChange,
  onMaxPointsEffect,
  disabled = false,
  hasEvaluations = false,
  showManageLink = true,
  onCommitOneOff = null,
  commitOneOffBusy = false,
  showMaxPointsField = false,
  maxPoints = "",
  onMaxPointsChange = null,
  maxLocked = false,
  maxHint = null,
  compact = false,
  embedded = false,
}) {
  const selection = value || emptyEvaluationSelection();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState("pick");
  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(selection.mode === "oneoff");
  const [compactConfigOpen, setCompactConfigOpen] = useState(false);
  const [err, setErr] = useState("");
  const [createForm, setCreateForm] = useState(() => {
    const seed = defaultRubricEditorState("qualitative");
    return {
      name: "",
      description: "",
      scoringMode: "qualitative",
      criteria: seed.criteria,
    };
  });

  useEffect(() => {
    const effect = selectionMaxPointsEffect(selection);
    onMaxPointsEffect?.(effect);
  }, [selection, onMaxPointsEffect]);

  useEffect(() => {
    if (selection.mode === "oneoff") setOneOffOpen(true);
  }, [selection.mode]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    const { templates: rows, error } = await listMyRubricTemplates();
    setLoadingTemplates(false);
    if (error) {
      setErr(error);
      setTemplates([]);
      return;
    }
    setTemplates(rows || []);
  };

  const openPicker = async () => {
    if (disabled || hasEvaluations) return;
    setErr("");
    setOverlayMode("pick");
    setSearch("");
    setOverlayOpen(true);
    await loadTemplates();
  };

  const openCreateInOverlay = async () => {
    if (disabled || hasEvaluations) return;
    const seed = defaultRubricEditorState("qualitative");
    setCreateForm({
      name: "",
      description: "",
      scoringMode: "qualitative",
      criteria: seed.criteria,
    });
    setOverlayMode("create");
    setOverlayOpen(true);
    if (!templates.length) await loadTemplates();
  };

  const handleUseTemplate = async (row) => {
    if (busy || hasEvaluations) return;
    setBusy(true);
    setErr("");
    const { template, error } = await getRubricTemplate(row.id);
    setBusy(false);
    if (error || !template) {
      setErr(error || t("pcRubricLoadFail"));
      return;
    }
    const next = selectionFromTemplate(template);
    onChange?.(next);
    setPreviewOpen(false);
    setOneOffOpen(false);
    setOverlayOpen(false);
  };

  const handleCreateSave = async () => {
    if (busy || hasEvaluations) return;
    setBusy(true);
    setErr("");
    const criteria = criteriaPayloadFromEditor(createForm.criteria, createForm.scoringMode);
    const r = await upsertRubricTemplate({
      templateId: null,
      name: createForm.name.trim(),
      description: createForm.description.trim() || null,
      scoringMode: createForm.scoringMode,
      criteria,
    });
    if (!r.ok) {
      setBusy(false);
      setErr(r.error || t("pcRubricSaveFail"));
      return;
    }
    const templateId = r.result?.template_id;
    if (!templateId) {
      setBusy(false);
      setErr(t("pcRubricSaveFail"));
      return;
    }
    const { template, error } = await getRubricTemplate(templateId);
    setBusy(false);
    if (error || !template) {
      setErr(error || t("pcRubricLoadFail"));
      return;
    }
    onChange?.(selectionFromTemplate(template));
    setPreviewOpen(false);
    setOneOffOpen(false);
    setOverlayOpen(false);
  };

  const startOneOff = () => {
    if (disabled || hasEvaluations) return;
    const seed = defaultRubricEditorState("points");
    onChange?.({
      mode: "oneoff",
      templateId: null,
      name: t("pcRubricUntitled"),
      description: "",
      scoringMode: "points",
      criteria: seed.criteria,
      // Staged one-off — do not claim a persisted activity copy yet.
      ownCopy: false,
    });
    setOneOffOpen(true);
    setPreviewOpen(false);
    setOverlayOpen(false);
  };

  const clearSelection = () => {
    if (disabled || hasEvaluations) return;
    onChange?.(emptyEvaluationSelection());
    setPreviewOpen(false);
    setOneOffOpen(false);
  };

  const criteriaLen = (selection.criteria || []).length;
  const ceiling =
    selection.scoringMode === "points"
      ? rubricPointsCeiling(criteriaPayloadFromEditor(selection.criteria, "points"))
      : null;

  const showCompactEmpty = compact && selection.mode === "none" && !compactConfigOpen;
  const showEmptyActions =
    selection.mode === "none" && (!compact || compactConfigOpen);
  const manageVisible =
    showManageLink && (!compact || selection.mode !== "none" || compactConfigOpen);
  const manageLink = manageVisible ? (
    <Link to="/dashboard/rubrics" className="auth-link pbc-eval-section__manage">
      {t("pcManageRubrics")}
    </Link>
  ) : null;

  return (
    <section
      className={`pbc-eval-section${compact ? " pbc-eval-section--compact" : ""}${
        embedded ? " pbc-eval-section--embedded" : ""
      }`}
      {...(embedded
        ? { "aria-label": t("pcEvaluation") }
        : { "aria-labelledby": "pbc-eval-title" })}
    >
      {!embedded ? (
        <header className="pbc-eval-section__head">
          <h3 id="pbc-eval-title" className="pbc-eval-section__title">
            <span aria-hidden>
              <IconRubricMatrix size={20} />
            </span>
            <span>{t("pcEvaluation")}</span>
          </h3>
          {manageLink}
        </header>
      ) : null}

      {showMaxPointsField ? (
        <div className="pbc-eval-max-points">
          <label className="auth-org-label" htmlFor="act-points">
            {t("pcMaxPoints")}
          </label>
          <input
            id="act-points"
            type="number"
            min="0"
            step="0.5"
            className="auth-org-input auth-org-input--block"
            value={maxPoints}
            onChange={(e) => onMaxPointsChange?.(e.target.value)}
            disabled={disabled || maxLocked}
            placeholder="100"
          />
          {maxHint ? (
            <p className="pbc-eval-max-hint">{maxHint}</p>
          ) : (
            <p className="pbc-field-hint">{t("pcMaxPointsHint")}</p>
          )}
        </div>
      ) : null}

      {err ? (
        <p className="pbc-alert pbc-alert--error" role="alert">
          {err}
        </p>
      ) : null}

      {hasEvaluations ? (
        <p className="pbc-eval-locked" role="status">
          {t("pcRubricHasEvaluationsLocked")}
        </p>
      ) : null}

      {selection.mode === "none" ? (
        <div className="pbc-eval-empty">
          <div className="pbc-eval-empty__label">
            {!embedded ? (
              <span aria-hidden>
                <IconRubricMatrix size={18} />
              </span>
            ) : null}
            <span>
              {embedded ? t("pcEvaluation") : t("pcRubric")} · {t("pcRubricChoiceNone")}
            </span>
          </div>
          {showCompactEmpty ? (
            <div className="pbc-eval-empty__actions">
              <button
                type="button"
                className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-eval-btn-with-icon"
                disabled={disabled || hasEvaluations}
                onClick={() => setCompactConfigOpen(true)}
              >
                <IconAssign size={18} />
                <span>{t("pcConfigure")}</span>
              </button>
            </div>
          ) : null}
          {showEmptyActions ? (
            <div className="pbc-eval-empty__actions">
              <button
                type="button"
                className="pbc-btn pbc-btn--primary pbc-btn--sm pbc-eval-btn-with-icon"
                disabled={disabled || hasEvaluations}
                onClick={() => void openPicker()}
              >
                <IconAssign size={18} />
                <span>{t("pcChooseRubric")}</span>
              </button>
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
                disabled={disabled || hasEvaluations}
                onClick={() => void openCreateInOverlay()}
              >
                <IconPlus size={18} />
                <span>{t("pcCreateNew")}</span>
              </button>
              <button
                type="button"
                className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon pbc-eval-empty__secondary"
                disabled={disabled || hasEvaluations}
                onClick={startOneOff}
              >
                <IconCopy size={18} />
                <span>{t("pcCreateOnlyForActivity")}</span>
              </button>
              {embedded ? manageLink : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pbc-eval-summary">
          <div className="pbc-eval-summary__main">
            {embedded ? (
              <p className="pbc-eval-summary__embed-label">
                {t("pcEvaluation")} · {selection.name || t("pcRubricUntitled")}
              </p>
            ) : (
              <h4 className="pbc-eval-summary__name">{selection.name || t("pcRubricUntitled")}</h4>
            )}
            <p className="pbc-eval-summary__meta">
              {modeLabel(selection.scoringMode)}
              {criteriaLen ? ` · ${criteriaCountLabel(criteriaLen)}` : ""}
              {selection.scoringMode === "points" && ceiling != null
                ? ` · ${ceiling} pts`
                : ""}
            </p>
            {selection.description ? (
              <p className="pbc-eval-summary__desc">{selection.description}</p>
            ) : null}
            {selection.ownCopy ? (
              <p className="pbc-eval-summary__copy">{t("pcRubricOwnCopy")}</p>
            ) : null}
            {selection.scoringMode === "qualitative" ? (
              <p className="pbc-eval-summary__hint">{t("pcRubricNoNumericGrade")}</p>
            ) : (
              <p className="pbc-eval-summary__hint">{t("pcMaxDefinedByRubric")}</p>
            )}
          </div>
          <div className="pbc-eval-summary__actions">
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
              disabled={disabled}
              onClick={() => setPreviewOpen((v) => !v)}
            >
              <IconEye size={18} />
              <span>{t("pcView")}</span>
            </button>
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
              disabled={disabled || hasEvaluations}
              onClick={() => void openPicker()}
            >
              <IconSwap size={18} />
              <span>{t("pcChange")}</span>
            </button>
            <button
              type="button"
              className="pbc-btn pbc-btn--ghost pbc-btn--sm pbc-eval-btn-with-icon"
              disabled={disabled || hasEvaluations}
              onClick={clearSelection}
            >
              <IconTrash size={18} />
              <span>{t("pcRemove")}</span>
            </button>
            {embedded ? manageLink : null}
          </div>
          {previewOpen ? (
            <ReadOnlyRubricPreview
              criteria={selection.criteria}
              scoringMode={selection.scoringMode}
            />
          ) : null}
        </div>
      )}

      {selection.mode === "oneoff" && oneOffOpen ? (
        <div className="pbc-eval-oneoff">
          {selection.ownCopy ? (
            <p className="pbc-eval-summary__copy">{t("pcRubricOwnCopy")}</p>
          ) : null}
          <div className="pbc-rubric-author__row">
            <label className="auth-card__muted">
              {t("pcRubricMode")}{" "}
              <select
                className="auth-org-input"
                value={selection.scoringMode}
                disabled={disabled || hasEvaluations}
                onChange={(e) => {
                  const scoringMode = e.target.value;
                  onChange?.({
                    ...selection,
                    scoringMode,
                    criteria: (selection.criteria || []).map((c) => ({
                      ...c,
                      levels: (c.levels || []).map((lv) => ({
                        ...lv,
                        points: scoringMode === "points" ? lv.points ?? "" : null,
                      })),
                    })),
                  });
                }}
              >
                <option value="points">{t("pcRubricModePoints")}</option>
                <option value="qualitative">{t("pcRubricModeQualitative")}</option>
              </select>
            </label>
          </div>
          <RubricCriteriaEditor
            scoringMode={selection.scoringMode}
            criteria={selection.criteria}
            onCriteriaChange={(criteria) => onChange?.({ ...selection, criteria })}
            busy={disabled || hasEvaluations}
          />
          {onCommitOneOff ? (
            <div className="pbc-activity-actions pbc-activity-actions--wrap">
              <button
                type="button"
                className="pbc-btn pbc-btn--primary pbc-btn--sm"
                disabled={disabled || hasEvaluations || commitOneOffBusy || criteriaLen === 0}
                onClick={() => onCommitOneOff?.(selection)}
              >
                {commitOneOffBusy ? t("pcSaving") : t("pcRubricSaveOnActivity")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <RubricPickerOverlay
        open={overlayOpen}
        overlayMode={overlayMode}
        onOverlayModeChange={setOverlayMode}
        search={search}
        onSearchChange={setSearch}
        templates={templates}
        loading={loadingTemplates}
        busy={busy}
        onClose={() => setOverlayOpen(false)}
        onUse={handleUseTemplate}
        onCreateSave={handleCreateSave}
        createForm={createForm}
        onCreateFormChange={setCreateForm}
      />
    </section>
  );
}

export { ReadOnlyRubricPreview };
