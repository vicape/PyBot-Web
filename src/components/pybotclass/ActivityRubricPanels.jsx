/**
 * P9 rubric authoring / grading / student result panels.
 * One responsive implementation (matrix on desktop, cards on narrow).
 */
import { quantitativeTotalFromLevels } from "../../platform/rubrics.js";

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
}) {
  const isLegacy = schemaGeneration === 1;
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
    <div className="pbc-rubric-author">
      <div className="pbc-rubric-author__row">
        <label className="auth-card__muted">
          Modo{" "}
          <select
            className="auth-org-input"
            value={scoringMode}
            disabled={busy || isLegacy}
            onChange={(e) => onScoringModeChange(e.target.value)}
          >
            <option value="points">Puntos</option>
            <option value="qualitative">Cualitativo</option>
          </select>
        </label>
        {templates.length > 0 ? (
          <label className="auth-card__muted">
            Plantilla{" "}
            <select
              className="auth-org-input"
              value={selectedTemplateId}
              disabled={busy}
              onChange={(e) => onSelectTemplate?.(e.target.value)}
            >
              <option value="">— Elegir plantilla —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="auth-btn auth-btn--ghost auth-btn--sm"
          disabled={busy || !selectedTemplateId}
          onClick={() => onApplyTemplate?.()}
        >
          Usar en actividad
        </button>
        {hasFrozenRubric ? (
          <button
            type="button"
            className="auth-btn auth-btn--ghost auth-btn--sm"
            disabled={busy}
            onClick={() => onClearRubric?.()}
          >
            Sin rúbrica
          </button>
        ) : null}
      </div>

      {isLegacy ? (
        <p className="auth-card__muted">
          Rúbrica heredada (criterios + puntos numéricos, sin niveles). Se conserva tal cual.
        </p>
      ) : (
        <p className="auth-card__muted">
          Estructura: criterio → niveles de logro. La asociación congela una copia independiente en
          la actividad.
          {isPoints && activityMaxPoints != null
            ? ` La suma de máximos por criterio debe coincidir con ${activityMaxPoints}.`
            : null}
          {!isPoints ? " En modo cualitativo no se requiere puntaje numérico." : null}
        </p>
      )}

      {criteria.map((c, cIdx) => (
        <div key={c.id || `c-${cIdx}`} className="pbc-rubric-author__criterion">
          <div className="pbc-rubric-author__row">
            <input
              className="auth-org-input"
              placeholder="Criterio"
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
                placeholder="Máx"
                value={c.max_points ?? ""}
                disabled={busy}
                onChange={(e) => updateCriterion(cIdx, { max_points: e.target.value })}
              />
            ) : null}
            <input
              className="auth-org-input"
              placeholder="Descripción (opcional)"
              value={c.description || ""}
              disabled={busy}
              onChange={(e) => updateCriterion(cIdx, { description: e.target.value })}
            />
            <button
              type="button"
              className="auth-btn auth-btn--ghost auth-btn--sm"
              disabled={busy}
              onClick={() => onCriteriaChange(criteria.filter((_, i) => i !== cIdx))}
            >
              Quitar
            </button>
          </div>
          {!isLegacy
            ? (c.levels || []).map((lv, lIdx) => (
                <div key={lv.id || `l-${cIdx}-${lIdx}`} className="pbc-rubric-author__level">
                  <input
                    className="auth-org-input"
                    placeholder="Nivel"
                    value={lv.name}
                    disabled={busy}
                    onChange={(e) => updateLevel(cIdx, lIdx, { name: e.target.value })}
                  />
                  <input
                    className="auth-org-input"
                    placeholder="Descriptor del criterio"
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
                      placeholder="Pts"
                      value={lv.points ?? ""}
                      disabled={busy}
                      onChange={(e) => updateLevel(cIdx, lIdx, { points: e.target.value })}
                    />
                  ) : null}
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
                    Quitar nivel
                  </button>
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
              Agregar nivel
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
            Agregar criterio
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
            Agregar criterio
          </button>
        )}
        <button
          type="button"
          className="auth-btn auth-btn--primary auth-btn--sm"
          disabled={busy || criteria.length === 0}
          onClick={() => onSaveActivityRubric?.()}
        >
          Guardar rúbrica en actividad
        </button>
        {!isLegacy ? (
          <>
            <input
              className="auth-org-input"
              placeholder="Nombre plantilla reutilizable"
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
              Guardar como plantilla
            </button>
          </>
        ) : null}
      </div>
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
