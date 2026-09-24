/**
 * Future PyBot Virtual Tutor — architecture / product invariant (foundation only).
 *
 * This module documents the contract the Material V2 content model must satisfy
 * so a later server-side tutor can consume Material safely.
 *
 * THIS TASK DOES NOT implement the tutor, connect any AI provider, or expose
 * API keys / provider secrets to the browser.
 */

export const PYBOT_TUTOR_CONTRACT = Object.freeze({
  version: 1,
  status: "documented_not_implemented",
  purpose: "HELP_THE_STUDENT_STUDY",
  neverSolve: Object.freeze([
    "exercise",
    "task",
    "quiz",
    "test",
    "project",
  ]),
  scaffoldingAllowed: Object.freeze([
    "questions",
    "concept_explanations",
    "hints",
    "debugging_guidance",
    "analogous_examples",
    "progressive_support",
  ]),
  forbiddenOutputs: Object.freeze([
    "final_answer",
    "completed_solution",
    "answer_key",
    "finished_code_that_satisfies_assigned_work",
  ]),
  quizTestRestriction: "even_more_restrictive",
  credentials: "server_side_only_never_browser",
  contextFields: Object.freeze([
    "material_identity",
    "provenance",
    "language",
    "recommended_age",
    "difficulty",
    "estimated_time",
    "subject_tags",
    "learning_objectives",
    "prerequisites",
    "current_unit_item",
    "item_type",
    "current_material_text_doc",
    "exercise_task_starter_code_when_relevant",
  ]),
});

/**
 * Shape of tutor context that Material should be able to supply later.
 * Pure documentation helper — no network / AI calls.
 */
export function buildTutorContextSkeleton(material = {}, current = {}) {
  return {
    contractVersion: PYBOT_TUTOR_CONTRACT.version,
    material: {
      id: material.id ?? null,
      title: material.title ?? null,
      language_code: material.language_code ?? null,
      recommended_age_min: material.recommended_age_min ?? null,
      recommended_age_max: material.recommended_age_max ?? null,
      difficulty: material.difficulty ?? null,
      estimated_minutes: material.estimated_minutes ?? null,
      subject: material.subject ?? null,
      tags: material.tags ?? [],
      learning_objectives: material.learning_objectives ?? [],
      prerequisites: material.prerequisites ?? [],
      provenance: {
        copied_from_content_id: material.copied_from_content_id ?? null,
        original_content_id: material.original_content_id ?? null,
        original_owner_id: material.original_owner_id ?? null,
        owner_id: material.owner_id ?? null,
      },
    },
    current: {
      unitId: current.unitId ?? null,
      unitTitle: current.unitTitle ?? null,
      unitType: current.unitType ?? null,
      itemId: current.itemId ?? null,
      itemTitle: current.itemTitle ?? null,
      itemType: current.itemType ?? null,
      documentTextOrJson: current.document ?? null,
      starterCode: current.starterCode ?? null,
    },
    invariants: {
      helpStudyOnly: true,
      neverSolveAssignedWork: true,
      credentialsServerSideOnly: true,
      aiImplemented: false,
    },
  };
}
