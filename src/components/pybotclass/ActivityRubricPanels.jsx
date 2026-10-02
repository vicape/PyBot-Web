/**
 * P9 rubric authoring / grading / student result panels.
 * One responsive implementation (matrix on desktop, cards on narrow).
 * Library authoring reuses the same criterion → levels editor (no second model).
 */
import { Link } from "react-router-dom";
import { quantitativeTotalFromLevels } from "../../platform/rubrics.js";
import { t } from "../../i18n.js";

function emptyLevel(scoringMode) {
  return {
    name: "",
    descriptor: "",
    points: scoringMode === "points" ? "" : null,
  };
}

function emptyCriterion(scoringMode) {
  return {
    name: "",
    description: "",
    levels: [emptyLevel(scoringMode), emptyLevel(scoringMode)],
  };
}

export function defaultRubricEditorState(scoringMode = "points") {
  return {
    scoringMode,
    name: "",
    description: "",
    criteria: [emptyCriterion(scoringMode)],
  };
}

export { emptyLevel, emptyCriterion };

function moveItem(list, index, delta) {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  return next;
}

/** Shared P9 criterion → levels editor (library + activity one-off). */
export function RubricCriteriaEditor({
  scoringMode,
  criteria,
  onCriteriaChange,
  busy = false,
  isLegacy = false,
}) {
  const isPoints = scoringMode === "points";

  const updateCriterion = (idx, patch) => {
    const next = criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onCriteriaChange(next);
  };

  const updateLevel = (cIdx, lIdx, patch) => {
    const next = criteria.map((c, i) => {
      if (i !== cIdx) return c;
      const levels = (c.levels || []).map((lv, j) => (j === lIdx ? { ...lv, ...patch } : lv));
      return { ...c, levels };
    });
    onCriteriaChange(next);
  };

  return (
    <div className="pbc-rubric-criteria-editor">
      {criteria.map((c, cIdx) => (
        <div key={c.id || `c-${cIdx}`} className="pbc-rubric-author__criterion">
          <div className="pbc-rubric-author__row">
            <input
              className="auth-org-input"
              placeholder={t("pcRubricCriterionPlaceholder")}
              aria-label={t("pcRubricCriterionPlaceholder")}
              value={c.name}
              disabled={busy}
              onChange={(e) => updateCriterion(cIdx, { name: e.target.value })}
            />
            {isLegacy ? (
              <input
                className="auth-org-input"
                type="number"
                min="0"
                step="0.5"
                placeholder={t("pcRubricMaxShort")}
                aria-label={t("pcRubricMaxShort")}
                value={c.max_points ?? ""}
                disabled={busy}
                onChange={(e) => updateCriterion(cIdx, { max_points: e.target.value })}
              />
            ) : null}
            <input
              className="auth-org-input"
              placeholder={t("pcRubricCriterionDescPlaceholder")}
              aria-label={t("pcRubricCriterionDescPlaceholder")}
              value={c.description || ""}
              disabled={busy}
              onChange={(e) => updateCriterion(cIdx, { description: e.target.value })}
            />
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy || cIdx === 0}
              aria-label={t("pcRubricMoveUp")}
              onClick={() => onCriteriaChange(moveItem(criteria, cIdx, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy || cIdx >= criteria.length - 1}
              aria-label={t("pcRubricMoveDown")}
              onClick={() => onCriteriaChange(moveItem(criteria, cIdx, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy}
              onClick={() => onCriteriaChange(criteria.filter((_, i) => i !== cIdx))}
            >
              {t("pcRubricRemove")}
            </button>
          </div>
          {!isLegacy
            ? (c.levels || []).map((lv, lIdx) => (
                <div key={lv.id || `l-${cIdx}-${lIdx}`} className="pbc-rubric-author__level">
                  <input
                    className="auth-org-input"
                    placeholder={t("pcRubricLevelPlaceholder")}
                    aria-label={t("pcRubricLevelPlaceholder")}
                    value={lv.name}
                    disabled={busy}
                    onChange={(e) => updateLevel(cIdx, lIdx, { name: e.target.value })}
                  />
                  <input
                    className="auth-org-input"
                    placeholder={t("pcRubricDescriptorPlaceholder")}
                    aria-label={t("pcRubricDescriptorPlaceholder")}
                    value={lv.descriptor || ""}
                    disabled={busy}
                    onChange={(e) => updateLevel(cIdx, lIdx, { descriptor: e.target.value })}
                  />
                  {isPoints ? (
                    <input
                      className="auth-org-input"
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder={t("pcRubricPtsShort")}
                      aria-label={t("pcRubricPtsShort")}
                      value={lv.points ?? ""}
                      disabled={busy}
                      onChange={(e) => updateLevel(cIdx, lIdx, { points: e.target.value })}
                    />
                  ) : null}
                  <div className="pbc-rubric-author__level-actions">
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={busy || lIdx === 0}
                      aria-label={t("pcRubricMoveUp")}
                      onClick={() =>
                        updateCriterion(cIdx, {
                          levels: moveItem(c.levels || [], lIdx, -1),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={busy || lIdx >= (c.levels || []).length - 1}
                      aria-label={t("pcRubricMoveDown")}
                      onClick={() =>
                        updateCriterion(cIdx, {
                          levels: moveItem(c.levels || [], lIdx, 1),
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="auth-btn auth-btn--ghost auth-btn--sm"
                      disabled={busy}
                      onClick={() =>
                        updateCriterion(cIdx, {
                          levels: (c.levels || []).filter((_, i) => i !== lIdx),
                        })
                      }
                    >
                      {t("pcRubricRemoveLevel")}
                    </button>
                  </div>
                </div>
              ))
            : null}
          {!isLegacy ? (
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy}
              onClick={() =>
                updateCriterion(cIdx, {
                  levels: [...(c.levels || []), emptyLevel(scoringMode)],
                })
              }
            >
              {t("pcRubricAddLevel")}
            </button>
          ) : null}
        </div>
      ))}

      <div className="pbc-activity-actions pbc-activity-actions--wrap">
        {!isLegacy ? (
          <button
            type="button"
            className="auth-btn auth-btn--ghost auth-btn--sm"
            disabled={busy}
            onClick={() => onCriteriaChange([...criteria, emptyCriterion(scoringMode)])}
          >
            {t("pcRubricAddCriterion")}
          </button>
        ) : (
          <button
            type="button"
            className="auth-btn auth-btn--ghost auth-btn--sm"
            disabled={busy}
            onClick={() =>
              onCriteriaChange([
                ...criteria,
                { name: "", description: "", max_points: "", levels: [] },
              ])
            }
          >
            {t("pcRubricAddCriterion")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Library create/edit form for reusable P9 templates. */
export function RubricTemplateAuthoringForm({
  name,
  onNameChange,
  description = "",
  onDescriptionChange,
  scoringMode,
  onScoringModeChange,
  criteria,
  onCriteriaChange,
  busy = false,
  onSave,
  onCancel,
  saveLabel,
}) {
  const isPoints = scoringMode === "points";
  return (
    <div className="pbc-rubric-author pbc-rubric-template-form">
      <div className="pbc-rubric-author__row">
        <label className="auth-card__muted pbc-rubric-template-form__field">
          {t("pcRubricName")}
          <input
            className="auth-org-input"
            value={name}
            disabled={busy}
            onChange={(e) => onNameChange?.(e.target.value)}
            required
          />
        </label>
        <label className="auth-card__muted pbc-rubric-template-form__field">
          {t("pcRubricMode")}
          <select
            className="auth-org-input"
            value={scoringMode}
            disabled={busy}
            onChange={(e) => onScoringModeChange?.(e.target.value)}
          >
            <option value="qualitative">{t("pcRubricModeQualitative")}</option>
            <option value="points">{t("pcRubricModePoints")}</option>
          </select>
        </label>
      </div>
      <label className="auth-card__muted pbc-rubric-template-form__field pbc-rubric-template-form__field--full">
        {t("pcDescription")}
        <textarea
          className="auth-org-input"
          rows={2}
          value={description || ""}
          disabled={busy}
          onChange={(e) => onDescriptionChange?.(e.target.value)}
          placeholder={t("pcRubricDescOptional")}
        />
      </label>
      <p className="auth-card__muted">
        {t("pcRubricStructureHint")}
        {!isPoints ? ` ${t("pcRubricQualitativeHint")}` : ""}
      </p>
      <RubricCriteriaEditor
        scoringMode={scoringMode}
        criteria={criteria}
        onCriteriaChange={onCriteriaChange}
        busy={busy}
      />
      <div className="pbc-modal__actions pbc-rubric-template-form__actions">
        {onCancel ? (
          <button type="button" className="pbc-btn pbc-btn--ghost" disabled={busy} onClick={onCancel}>
            {t("pcCancel")}
          </button>
        ) : null}
        <button
          type="button"
          className="pbc-btn pbc-btn--primary"
          disabled={busy || !String(name || "").trim() || criteria.length === 0}
          onClick={() => onSave?.()}
        >
          {busy ? t("pcSaving") : saveLabel || t("pcSave")}
        </button>
      </div>
    </div>
  );
}

export function ActivityRubricAuthoringPanel({
  scoringMode,
  onScoringModeChange,
  criteria,
  onCriteriaChange,
  templates = [],
  selectedTemplateId = "",
  onSelectTemplate,
  onApplyTemplate,
  onClearRubric,
  onSaveActivityRubric,
  onSaveAsTemplate,
  templateName = "",
  onTemplateNameChange,
  busy = false,
  activityMaxPoints = null,
  hasFrozenRubric = false,
  schemaGeneration = null,
  activityChoice = "create",
  onActivityChoiceChange,
}) {
  const isLegacy = schemaGeneration === 1;
  const isPoints = scoringMode === "points";
  const choice = activityChoice || (hasFrozenRubric ? "choose" : "none");

  return (
    <div className="pbc-rubric-author">
      <fieldset className="pbc-rubric-choice" disabled={busy}>
        <legend className="auth-card__muted">{t("pcRubricActivityChoiceLegend")}</legend>
        <label className="pbc-rubric-choice__option">
          <input
            type="radio"
            name="activity-rubric-choice"
            value="none"
            checked={choice === "none"}
            onChange={() => onActivityChoiceChange?.("none")}
          />
          {t("pcRubricChoiceNone")}
        </label>
        <label className="pbc-rubric-choice__option">
          <input
            type="radio"
            name="activity-rubric-choice"
            value="choose"
            checked={choice === "choose"}
            onChange={() => onActivityChoiceChange?.("choose")}
          />
          {t("pcRubricChoiceFromMine")}
        </label>
        <label className="pbc-rubric-choice__option">
          <input
            type="radio"
            name="activity-rubric-choice"
            value="create"
            checked={choice === "create"}
            onChange={() => onActivityChoiceChange?.("create")}
          />
          {t("pcRubricChoiceCreateForActivity")}
        </label>
      </fieldset>

      <p className="pbc-rubric-manage-link">
        <Link to="/dashboard/rubrics" className="auth-link">
          {t("pcManageRubrics")}
        </Link>
      </p>

      {choice === "none" ? (
        <div className="pbc-rubric-choice-panel">
          <p className="auth-card__muted">{t("pcRubricNoneHint")}</p>
          {hasFrozenRubric ? (
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy}
              onClick={() => onClearRubric?.()}
            >
              {t("pcRubricChoiceNone")}
            </button>
          ) : null}
        </div>
      ) : null}

      {choice === "choose" ? (
        <div className="pbc-rubric-choice-panel">
          <div className="pbc-rubric-author__row">
            <label className="auth-card__muted">
              {t("pcRubricTemplate")}{" "}
              <select
                className="auth-org-input"
                value={selectedTemplateId}
                disabled={busy}
                onChange={(e) => onSelectTemplate?.(e.target.value)}
              >
                <option value="">{t("pcRubricPickTemplate")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={busy || !selectedTemplateId}
              onClick={() => onApplyTemplate?.()}
            >
              {t("pcRubricApplyToActivity")}
            </button>
          </div>
          {templates.length === 0 ? (
            <p className="auth-card__muted">
              {t("pcRubricNoTemplatesYet")}{" "}
              <Link to="/dashboard/rubrics" className="auth-link">
                {t("pcManageRubrics")}
              </Link>
            </p>
          ) : (
            <p className="auth-card__muted">{t("pcRubricApplySnapshotHint")}</p>
          )}
          {hasFrozenRubric ? (
            <p className="auth-card__muted" role="status">
              {t("pcRubricHasFrozen")}
            </p>
          ) : null}
        </div>
      ) : null}

      {choice === "create" ? (
        <div className="pbc-rubric-choice-panel">
          <div className="pbc-rubric-author__row">
            <label className="auth-card__muted">
              {t("pcRubricMode")}{" "}
              <select
                className="auth-org-input"
                value={scoringMode}
                disabled={busy || isLegacy}
                onChange={(e) => onScoringModeChange(e.target.value)}
              >
                <option value="points">{t("pcRubricModePoints")}</option>
                <option value="qualitative">{t("pcRubricModeQualitativeShort")}</option>
              </select>
            </label>
            {hasFrozenRubric ? (
              <button
                type="button"
                className="auth-btn auth-btn--ghost auth-btn--sm"
                disabled={busy}
                onClick={() => onClearRubric?.()}
              >
                {t("pcRubricChoiceNone")}
              </button>
            ) : null}
          </div>

          {isLegacy ? (
            <p className="auth-card__muted">{t("pcRubricLegacyHint")}</p>
          ) : (
            <p className="auth-card__muted">
              {t("pcRubricStructureHint")}
              {isPoints && activityMaxPoints != null
                ? ` ${t("pcRubricMaxMustMatch").replace("{n}", String(activityMaxPoints))}`
                : null}
              {!isPoints ? ` ${t("pcRubricQualitativeHint")}` : null}
            </p>
          )}

          <RubricCriteriaEditor
            scoringMode={scoringMode}
            criteria={criteria}
            onCriteriaChange={onCriteriaChange}
            busy={busy}
            isLegacy={isLegacy}
          />

          <div className="pbc-activity-actions pbc-activity-actions--wrap">
            <button
              type="button"
              className="auth-btn auth-btn--primary auth-btn--sm"
              disabled={busy || criteria.length === 0}
              onClick={() => onSaveActivityRubric?.()}
            >
              {t("pcRubricSaveOnActivity")}
            </button>
            {!isLegacy ? (
              <>
                <input
                  className="auth-org-input"
                  placeholder={t("pcRubricTemplateNamePlaceholder")}
                  aria-label={t("pcRubricTemplateNamePlaceholder")}
                  value={templateName}
                  disabled={busy}
                  onChange={(e) => onTemplateNameChange?.(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--sm"
                  disabled={busy || !templateName.trim() || criteria.length === 0}
                  onClick={() => onSaveAsTemplate?.()}
                >
                  {t("pcRubricSaveAsTemplate")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ActivityRubricGradeMatrix({
  criteria = [],
  scoringMode = "points",
  schemaGeneration = 2,
  draft = {},
  onChange,
  disabled = false,
}) {
  const isLegacy = schemaGeneration === 1 || criteria.every((c) => !(c.levels || []).length);
  const isPoints = scoringMode === "points" || isLegacy;

  const selectedByCriterion = {};
  for (const c of criteria) {
    if (draft[c.id]?.level_id) selectedByCriterion[c.id] = draft[c.id].level_id;
  }
  const liveTotal =
    !isLegacy && isPoints ? quantitativeTotalFromLevels(criteria, selectedByCriterion) : null;

  if (isLegacy) {
    return (
      <div className="pbc-activity-rubric-grade">
        {criteria.map((c) => (
          <div key={c.id} className="pbc-rubric-grade-legacy-row">
            <span className="auth-card__muted">
              {c.name} (máx {c.max_points})
            </span>
            <input
              className="auth-org-input"
              type="number"
              min="0"
              max={c.max_points}
              step="0.5"
              placeholder="Pts"
              disabled={disabled}
              value={draft[c.id]?.points ?? ""}
              onChange={(e) =>
                onChange?.({
                  ...draft,
                  [c.id]: { ...draft[c.id], points: e.target.value },
                })
              }
            />
            <input
              className="auth-org-input"
              placeholder="Comentario criterio"
              disabled={disabled}
              value={draft[c.id]?.comment ?? ""}
              onChange={(e) =>
                onChange?.({
                  ...draft,
                  [c.id]: { ...draft[c.id], comment: e.target.value },
                })
              }
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pbc-rubric-matrix-wrap">
      <div className="pbc-rubric-matrix" role="table" aria-label="Rúbrica de evaluación">
        {criteria.map((c) => {
          const levels = c.levels || [];
          const selected = draft[c.id]?.level_id || "";
          return (
            <div key={c.id} className="pbc-rubric-matrix__row" role="row">
              <div className="pbc-rubric-matrix__criterion" role="cell">
                <strong>{c.name}</strong>
                {c.description ? (
                  <span className="auth-card__muted pbc-rubric-matrix__hint">{c.description}</span>
                ) : null}
              </div>
              <div className="pbc-rubric-matrix__levels" role="cell">
                {levels.map((lv) => {
                  const id = `rubric-${c.id}-${lv.id}`;
                  const checked = selected === lv.id;
                  return (
                    <label
                      key={lv.id}
                      className={`pbc-rubric-level-chip${checked ? " is-selected" : ""}`}
                      title={lv.descriptor || lv.name}
                    >
                      <input
                        type="radio"
                        name={`crit-${c.id}`}
                        id={id}
                        disabled={disabled}
                        checked={checked}
                        onChange={() =>
                          onChange?.({
                            ...draft,
                            [c.id]: { ...draft[c.id], level_id: lv.id },
                          })
                        }
                      />
                      <span className="pbc-rubric-level-chip__name">{lv.name}</span>
                      {isPoints && lv.points != null ? (
                        <span className="pbc-rubric-level-chip__pts">{lv.points}</span>
                      ) : null}
                      {lv.descriptor ? (
                        <span className="pbc-rubric-level-chip__desc">{lv.descriptor}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <input
                className="auth-org-input pbc-rubric-matrix__comment"
                placeholder="Comentario criterio"
                disabled={disabled}
                value={draft[c.id]?.comment ?? ""}
                onChange={(e) =>
                  onChange?.({
                    ...draft,
                    [c.id]: { ...draft[c.id], comment: e.target.value },
                  })
                }
              />
            </div>
          );
        })}
      </div>
      {isPoints ? (
        <p className="auth-card__muted pbc-rubric-matrix__total">
          Total (servidor al publicar):{" "}
          <strong>{liveTotal != null ? liveTotal : "—"}</strong>
        </p>
      ) : (
        <p className="auth-card__muted pbc-rubric-matrix__total">
          Evaluación cualitativa — sin nota numérica fabricada.
        </p>
      )}
    </div>
  );
}

export function ActivityRubricStudentResult({
  criteria = [],
  scores = [],
  scoringMode = "points",
  grade = null,
  maxPoints = null,
  feedback = null,
}) {
  const byCrit = new Map((scores || []).map((s) => [s.criterion_id, s]));
  const isPoints = scoringMode === "points";

  return (
    <div className="pbc-rubric-student-result">
      {criteria.map((c) => {
        const sc = byCrit.get(c.id);
        const levels = c.levels || [];
        const legacy = !levels.length;
        return (
          <article key={c.id} className="pbc-rubric-result-card">
            <h4 className="pbc-rubric-result-card__title">{c.name}</h4>
            {sc?.level_name ? (
              <p className="pbc-rubric-result-card__level">
                Nivel: <strong>{sc.level_name}</strong>
              </p>
            ) : null}
            {sc?.level_descriptor ? (
              <p className="auth-card__muted pbc-rubric-result-card__desc">{sc.level_descriptor}</p>
            ) : null}
            {sc?.comment ? (
              <p className="pbc-rubric-result-card__comment">Comentario: {sc.comment}</p>
            ) : null}
            {legacy && sc?.points != null ? (
              <p className="auth-card__muted">
                Puntos: {sc.points}
                {c.max_points != null ? ` / ${c.max_points}` : ""}
              </p>
            ) : null}
            {!legacy && isPoints && sc?.points != null ? (
              <p className="auth-card__muted">Puntos: {sc.points}</p>
            ) : null}
          </article>
        );
      })}
      {feedback ? (
        <p className="auth-card__muted" style={{ marginTop: "0.5rem" }}>
          Feedback: {feedback}
        </p>
      ) : null}
      {isPoints && grade != null ? (
        <p className="auth-card__muted">
          Nota: <strong>{grade}</strong>
          {maxPoints != null ? ` / ${maxPoints}` : null}
        </p>
      ) : null}
      {!isPoints ? (
        <p className="auth-card__muted">Evaluación cualitativa completada (sin nota numérica).</p>
      ) : null}
    </div>
  );
}
