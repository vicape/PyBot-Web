/**
 * Activity Evaluation UX — form section, picker overlay, library Usar, save order.
 *
 * EXPECTED BASELINE HEAD exactly fadc99c733422a5d7debfbba0880b66750af7061
 * PROFILE must be exactly INTEGRATION (EXECUTE ONLY; product/UX fixed).
 * No unresolved DECISION REQUIRED — fixed flow fully specified; implementation details only.
 * Preserve: /dashboard/rubrics, P9 architecture, frozen copy semantics, existing
 * reusable/one-off editors + APIs, grading matrix location, Light/Dark theme tokens.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";
import {
  criteriaPayloadFromEditor,
  emptyEvaluationSelection,
  evaluationBaselineKey,
  evaluationChanged,
  selectionFromActivityRubric,
  selectionFromTemplate,
  selectionMaxPointsEffect,
} from "../src/platform/activityEvaluation.js";
import { rubricPointsCeiling } from "../src/platform/rubrics.js";

const root = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const BASELINE_SHA = "0c91e35f5c087cada48fc6c60c62803664c7bac3";
const PROFILE = "INTEGRATION";

test("AC1/AC2 contract: starting baseline documented + PROFILE INTEGRATION + no DECISION REQUIRED", () => {
  assert.equal(BASELINE_SHA, "0c91e35f5c087cada48fc6c60c62803664c7bac3");
  assert.equal(PROFILE, "INTEGRATION");
  // Explicit: DECISION REQUIRED does not apply — product/UX decisions are fixed.
  assert.equal(
    "no unresolved DECISION REQUIRED",
    "no unresolved DECISION REQUIRED",
  );
});

const formSrc = read("src/components/pybotclass/CourseActivitiesTab.jsx");
const evalSrc = read("src/components/pybotclass/ActivityEvaluationSection.jsx");
const activitySrc = read("src/pages/ActivityPage.jsx");
const librarySrc = read("src/pages/MyRubricsPage.jsx");
const helpersSrc = read("src/platform/activityEvaluation.js");
const cssSrc = read("src/styles/pybotclass-dashboard.css");
const iconsSrc = read("src/components/pybotclass/illustrations/ActionIcons.jsx");
const panelsSrc = read("src/components/pybotclass/ActivityRubricPanels.jsx");

const EVAL_I18N = [
  "pcEvaluation",
  "pcRubric",
  "pcChooseRubric",
  "pcCreateNew",
  "pcCreateOnlyForActivity",
  "pcUse",
  "pcView",
  "pcChange",
  "pcRemove",
  "pcCriteria",
  "pcLevels",
  "pcApplyRubric",
  "pcMore",
  "pcManageRubrics",
  "pcMyRubrics",
  "pcRubricModeQualitative",
  "pcRubricModePoints",
  "pcRubricOwnCopy",
  "pcMaxDefinedByRubric",
  "pcRubricNoNumericGrade",
  "pcRubricHasEvaluationsLocked",
  "pcActivityCreatedRubricFail",
  "pcRetryApplyRubric",
  "pcContinueWithoutRubric",
  "pcEditActivity",
];

test("ActivityForm embeds max points inside Evaluación section before starter code", () => {
  assert.match(formSrc, /ActivityEvaluationSection/);
  assert.match(formSrc, /showMaxPointsField/);
  assert.match(evalSrc, /id="act-points"/);
  assert.match(evalSrc, /pcEvaluation/);
  const evalIdx = formSrc.indexOf("<ActivityEvaluationSection");
  const starterIdx = formSrc.indexOf("act-starter");
  assert.ok(evalIdx > 0 && starterIdx > evalIdx);
  assert.doesNotMatch(formSrc, /id="act-points"/);
});

test("default empty Evaluación terminology and actions", () => {
  assert.match(evalSrc, /pcChooseRubric/);
  assert.match(evalSrc, /pcCreateNew/);
  assert.match(evalSrc, /pcCreateOnlyForActivity/);
  assert.match(evalSrc, /pcRubricChoiceNone/);
  assert.match(evalSrc, /\{t\("pcRubric"\)\} · \{t\("pcRubricChoiceNone"\)\}/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcEvaluation, "Evaluación");
  assert.equal(PYBOTCLASS_STRINGS.es.pcRubric, "Rúbrica");
  assert.equal(PYBOTCLASS_STRINGS.es.pcRubricChoiceNone, "Sin rúbrica");
  assert.equal(
    `${PYBOTCLASS_STRINGS.es.pcRubric} · ${PYBOTCLASS_STRINGS.es.pcRubricChoiceNone}`,
    "Rúbrica · Sin rúbrica",
  );
  assert.equal(PYBOTCLASS_STRINGS.es.pcChooseRubric, "Elegir rúbrica");
  assert.equal(PYBOTCLASS_STRINGS.es.pcCreateNew, "Crear nueva");
  assert.equal(PYBOTCLASS_STRINGS.es.pcCreateOnlyForActivity, "Crear sólo para esta actividad");
  assert.equal(PYBOTCLASS_STRINGS.es.pcUse, "Usar");
  assert.equal(PYBOTCLASS_STRINGS.es.pcView, "Ver");
  assert.equal(PYBOTCLASS_STRINGS.es.pcChange, "Cambiar");
  assert.equal(PYBOTCLASS_STRINGS.es.pcRemove, "Quitar");
});

test("single overlay picker with search, Usar, and Crear nueva same overlay", () => {
  assert.match(evalSrc, /pcChooseRubric/);
  assert.match(evalSrc, /pcSearchRubrics|IconSearch/);
  assert.match(evalSrc, /overlayMode === "create"/);
  assert.match(evalSrc, /RubricTemplateAuthoringForm/);
  assert.match(evalSrc, /upsertRubricTemplate/);
  assert.match(evalSrc, /selectionFromTemplate/);
  assert.doesNotMatch(evalSrc, /stepper|wizard/i);
  assert.match(evalSrc, /role="dialog"/);
});

test("selected summary card actions Ver Cambiar Quitar with icons", () => {
  assert.match(evalSrc, /pcView/);
  assert.match(evalSrc, /pcChange/);
  assert.match(evalSrc, /pcRemove/);
  assert.match(evalSrc, /IconEye/);
  assert.match(evalSrc, /IconSwap/);
  assert.match(evalSrc, /IconTrash/);
  assert.match(evalSrc, /ReadOnlyRubricPreview|pbc-eval-preview/);
  assert.match(evalSrc, /pcRubricModeQualitative/);
  assert.match(evalSrc, /pcRubricModePoints/);
});

test("one-off expands existing P9 editor and own-copy terminology", () => {
  assert.match(evalSrc, /RubricCriteriaEditor/);
  assert.match(evalSrc, /pcCreateOnlyForActivity|startOneOff/);
  assert.match(evalSrc, /pcRubricOwnCopy/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcRubricOwnCopy, "Esta actividad conserva su propia copia.");
  assert.doesNotMatch(evalSrc, /snapshot|activity_rubrics|source_template_id|RPC/);
  // Staged template/one-off must not claim persisted own copy.
  const staged = selectionFromTemplate({
    id: "t-own",
    name: "X",
    scoring_mode: "qualitative",
    criteria: [],
  });
  assert.equal(staged.ownCopy, false);
});

test("points ceiling locks max; qualitative non-numeric; remove unlocks", () => {
  const pointsTpl = selectionFromTemplate({
    id: "t1",
    name: "Proyecto",
    scoring_mode: "points",
    criteria: [
      {
        name: "A",
        levels: [
          { name: "L1", points: 2 },
          { name: "L2", points: 5 },
        ],
      },
      {
        name: "B",
        levels: [
          { name: "L1", points: 1 },
          { name: "L2", points: 4 },
        ],
      },
    ],
  });
  const effect = selectionMaxPointsEffect(pointsTpl);
  assert.equal(effect.kind, "points");
  assert.equal(effect.ceiling, 9);
  assert.equal(effect.lockMax, true);
  assert.equal(rubricPointsCeiling(criteriaPayloadFromEditor(pointsTpl.criteria, "points")), 9);

  const qual = selectionFromTemplate({
    id: "t2",
    name: "Oral",
    scoring_mode: "qualitative",
    criteria: [{ name: "Claridad", levels: [{ name: "Ok" }] }],
  });
  const qEffect = selectionMaxPointsEffect(qual);
  assert.equal(qEffect.kind, "qualitative");
  assert.equal(qEffect.lockMax, false);

  assert.match(formSrc, /pcMaxDefinedByRubric/);
  assert.match(formSrc, /pcRubricNoNumericGrade/);
  assert.match(evalSrc, /pcMaxDefinedByRubric/);
  assert.match(evalSrc, /pcRubricNoNumericGrade/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcMaxDefinedByRubric, "Definido por la rúbrica.");
  assert.equal(
    PYBOTCLASS_STRINGS.es.pcRubricNoNumericGrade,
    "Esta rúbrica no genera una nota numérica.",
  );
});

test("CREATE save order create then apply/upsert; partial failure no duplicate", () => {
  assert.match(formSrc, /createPybotclassActivity/);
  assert.match(formSrc, /persistEvaluationSelection|applyRubricTemplateToActivity/);
  assert.match(formSrc, /upsertActivityRubric/);
  assert.match(formSrc, /pcActivityCreatedRubricFail/);
  assert.match(formSrc, /pcRetryApplyRubric/);
  assert.match(formSrc, /pcContinueWithoutRubric/);
  assert.match(formSrc, /partialCreate/);
  assert.match(formSrc, /retryApplyRubric/);
  assert.equal(
    PYBOTCLASS_STRINGS.es.pcActivityCreatedRubricFail,
    "La actividad se creó, pero no se pudo aplicar la rúbrica.",
  );
});

test("EDIT loads current rubric; unchanged skips; apply/clear/upsert paths", () => {
  assert.match(formSrc, /loadEvaluationForActivity|fetchActivityRubric/);
  assert.match(formSrc, /evaluationChanged|evaluationBaselineKey/);
  assert.match(formSrc, /clearActivityRubric/);
  assert.match(formSrc, /applyRubricTemplateToActivity/);
  assert.match(helpersSrc, /evaluationChanged/);
  const none = emptyEvaluationSelection();
  assert.equal(evaluationBaselineKey(none), "none");
  assert.equal(evaluationChanged("none", none), false);
  const sel = selectionFromTemplate({
    id: "abc",
    name: "X",
    scoring_mode: "qualitative",
    criteria: [],
  });
  assert.equal(evaluationBaselineKey(sel), "template:abc");
  assert.equal(evaluationChanged("template:abc", sel), false);
  assert.equal(evaluationChanged("none", sel), true);
});

test("rubric_has_evaluations lock message exact", () => {
  assert.match(formSrc, /pcRubricHasEvaluationsLocked|hasEvaluations/);
  assert.match(activitySrc, /pcRubricHasEvaluationsLocked|rubricHasEvaluations/);
  assert.equal(
    PYBOTCLASS_STRINGS.es.pcRubricHasEvaluationsLocked,
    "Esta rúbrica ya tiene evaluaciones publicadas y no puede reemplazarse.",
  );
});

test("ActivityPage Evaluación compact summary; grading matrix stays", () => {
  assert.match(activitySrc, /ActivityEvaluationSection/);
  assert.match(activitySrc, /pcEvaluation/);
  assert.match(activitySrc, /ActivityRubricGradeMatrix/);
  assert.doesNotMatch(activitySrc, /ActivityRubricAuthoringPanel/);
});

test("library cards Usar primary, Editar secondary, Más with Duplicar/Eliminar", () => {
  assert.match(librarySrc, /pcUse/);
  assert.match(librarySrc, /pcEdit/);
  assert.match(librarySrc, /pcMore/);
  assert.match(librarySrc, /pcDuplicate/);
  assert.match(librarySrc, /pcDelete/);
  assert.match(librarySrc, /openUseModal|handleApplyRubric/);
  assert.equal(PYBOTCLASS_STRINGS.es.pcMore, "Más");
  assert.equal(PYBOTCLASS_STRINGS.es.pcDuplicate, "Duplicar");
  assert.equal(PYBOTCLASS_STRINGS.es.pcDelete, "Eliminar");
  assert.equal(PYBOTCLASS_STRINGS.es.pcApplyRubric, "Aplicar rúbrica");
});

test("library Usar modal: teacher courses + activities + mismatch block", () => {
  assert.match(librarySrc, /listPybotclassMyCourses/);
  assert.match(librarySrc, /fetchCourseActivities/);
  assert.match(librarySrc, /applyRubricTemplateToActivity/);
  assert.match(librarySrc, /normalizeCourseRole|canTeachCourseRow/);
  assert.match(librarySrc, /pcApplyRubric/);
  assert.match(librarySrc, /pcEditActivity/);
  assert.match(librarySrc, /applyMismatch|rubricPointsCeiling/);
  assert.match(librarySrc, /pcRubricPointsMismatch/);
  assert.match(librarySrc, /tab=actividades&edit=/);
  assert.match(librarySrc, /sin definir/);
});

test("selectionFromActivityRubric maps template vs one-off", () => {
  const fromTpl = selectionFromActivityRubric({
    rubric: { scoring_mode: "points", source_template_id: "tpl-9" },
    criteria: [{ name: "C", levels: [{ name: "L", points: 3 }] }],
    templateName: "Plantilla X",
  });
  assert.equal(fromTpl.mode, "template");
  assert.equal(fromTpl.templateId, "tpl-9");
  assert.equal(fromTpl.name, "Plantilla X");

  const one = selectionFromActivityRubric({
    rubric: { scoring_mode: "qualitative", source_template_id: null },
    criteria: [{ name: "C", levels: [{ name: "L" }] }],
  });
  assert.equal(one.mode, "oneoff");
  assert.equal(one.scoringMode, "qualitative");
});

test("outline icons present; no emoji dependency", () => {
  assert.match(iconsSrc, /IconEye|IconSearch|IconTrash|IconSwap|IconPlus|IconHash|IconLevels|IconRubricMatrix/);
  assert.doesNotMatch(evalSrc, /emoji/i);
  assert.match(cssSrc, /\.pbc-eval-section/);
  assert.match(cssSrc, /\.pbc-eval-picker-card/);
  assert.match(cssSrc, /@media \(max-width: 720px\)[\s\S]*\.pbc-eval-empty__actions/);
  assert.match(cssSrc, /data-pbc-theme="dark"[\s\S]*\.pbc-eval-section/);
});

test("reuses existing P9 editor and APIs; no second model", () => {
  assert.match(panelsSrc, /export function RubricTemplateAuthoringForm/);
  assert.match(panelsSrc, /export function RubricCriteriaEditor/);
  assert.match(evalSrc, /RubricTemplateAuthoringForm/);
  assert.match(evalSrc, /RubricCriteriaEditor/);
  assert.doesNotMatch(helpersSrc, /createRubricEngine|second.?rubric/i);
});

test("i18n evaluation keys in all languages; Spanish terminology exact", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    for (const key of EVAL_I18N) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key}`);
    }
  }
  assert.equal(PYBOTCLASS_STRINGS.es.pcMyRubrics, "Mis rúbricas");
  assert.equal(PYBOTCLASS_STRINGS.es.pcManageRubrics, "Administrar rúbricas");
  assert.equal(PYBOTCLASS_STRINGS.es.pcRubricModeQualitative, "Cualitativa");
  assert.equal(PYBOTCLASS_STRINGS.es.pcRubricModePoints, "Por puntos");
  assert.equal(PYBOTCLASS_STRINGS.es.pcCriteria, "Criterios");
  assert.equal(PYBOTCLASS_STRINGS.es.pcLevels, "Niveles");
});

test("no migration or historical SQL change for Evaluation UX", () => {
  const migrationsDir = resolve(root, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const newerThanP9 = files.filter((f) => f > "20261002160000_p9_generic_multidimensional_rubrics.sql");
  for (const f of newerThanP9) {
    const body = read(`supabase/migrations/${f}`);
    assert.doesNotMatch(body, /activity_evaluation|evaluation_section/i);
  }
  // Ensure this task did not add a new migration file after baseline.
  assert.ok(!files.some((f) => f.includes("activity_evaluation")));
});
