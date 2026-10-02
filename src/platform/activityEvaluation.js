/**
 * Staged evaluation helpers for ActivityForm / compact ActivityPage summary.
 * Reuses existing P9 APIs and components only.
 * PROFILE: INTEGRATION. Baseline: fadc99c733422a5d7debfbba0880b66750af7061.
 * No unresolved DECISION REQUIRED — product/UX flow is fixed; helpers only.
 */
import { rubricPointsCeiling } from "./rubrics.js";

export function criteriaPayloadFromEditor(criteria, scoringMode) {
  return (criteria || [])
    .filter((c) => String(c.name || "").trim())
    .map((c) => ({
      name: String(c.name).trim(),
      description: c.description || null,
      levels: (c.levels || [])
        .filter((lv) => String(lv.name || "").trim())
        .map((lv) => ({
          name: String(lv.name).trim(),
          descriptor: lv.descriptor || null,
          points:
            scoringMode === "points" && lv.points !== "" && lv.points != null
              ? Number(lv.points)
              : null,
        })),
    }));
}

export function emptyEvaluationSelection() {
  return {
    mode: "none",
    templateId: null,
    name: "",
    description: "",
    scoringMode: "points",
    criteria: [],
    ownCopy: false,
  };
}

export function evaluationBaselineKey(selection) {
  if (!selection || selection.mode === "none") return "none";
  if (selection.mode === "template") {
    return `template:${selection.templateId || ""}`;
  }
  const payload = criteriaPayloadFromEditor(selection.criteria, selection.scoringMode);
  return `oneoff:${selection.scoringMode}:${JSON.stringify(payload)}`;
}

export function selectionFromActivityRubric({
  rubric,
  criteria,
  templateName = null,
} = {}) {
  if (!rubric) return emptyEvaluationSelection();
  const scoringMode = rubric.scoring_mode === "qualitative" ? "qualitative" : "points";
  const mapped = (criteria || []).map((c) => ({
    id: c.id,
    name: c.name || "",
    description: c.description || "",
    max_points: c.max_points,
    levels: (c.levels || []).map((lv) => ({
      id: lv.id,
      name: lv.name || "",
      descriptor: lv.descriptor || "",
      points: scoringMode === "points" && lv.points != null ? String(lv.points) : "",
    })),
  }));
  if (rubric.source_template_id) {
    return {
      mode: "template",
      templateId: rubric.source_template_id,
      name: templateName || "Rúbrica",
      description: "",
      scoringMode,
      criteria: mapped,
      ownCopy: true,
    };
  }
  return {
    mode: "oneoff",
    templateId: null,
    name: templateName || "Rúbrica",
    description: "",
    scoringMode,
    criteria: mapped,
    ownCopy: true,
  };
}

export function selectionFromTemplate(template) {
  if (!template?.id) return emptyEvaluationSelection();
  const scoringMode = template.scoring_mode === "qualitative" ? "qualitative" : "points";
  return {
    mode: "template",
    templateId: template.id,
    name: template.name || "Rúbrica",
    description: template.description || "",
    scoringMode,
    criteria: (template.criteria || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      description: c.description || "",
      levels: (c.levels || []).map((lv) => ({
        id: lv.id,
        name: lv.name || "",
        descriptor: lv.descriptor || "",
        points: scoringMode === "points" && lv.points != null ? String(lv.points) : "",
      })),
    })),
    ownCopy: true,
  };
}

export function selectionMaxPointsEffect(selection) {
  if (!selection || selection.mode === "none") {
    return { kind: "none", ceiling: null, lockMax: false };
  }
  if (selection.scoringMode === "qualitative") {
    return { kind: "qualitative", ceiling: null, lockMax: false };
  }
  const payload = criteriaPayloadFromEditor(selection.criteria, "points");
  const ceiling = rubricPointsCeiling(payload);
  return {
    kind: "points",
    ceiling: ceiling != null && Number.isFinite(ceiling) ? ceiling : null,
    lockMax: ceiling != null && Number.isFinite(ceiling),
  };
}

export function evaluationChanged(baselineKey, selection) {
  return evaluationBaselineKey(selection) !== (baselineKey || "none");
}
