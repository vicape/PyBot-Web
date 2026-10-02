/**
 * Rubric library UX — navigation, CRUD contract, activity integration (P9 reuse).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PRIMARY_NAV_IDS } from "../src/platform/uxIaHelpers.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";
import {
  normalizeRubricDefinition,
  rubricDuplicateName,
  snapshotTemplateToActivityRubric,
  templateEditAffectsSnapshot,
} from "../src/platform/rubrics.js";

const root = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const appSrc = read("src/App.jsx");
const sidebarSrc = read("src/components/pybotclass/layout/PyBotClassSidebar.jsx");
const iconsSrc = read("src/components/pybotclass/illustrations/SidebarIcons.jsx");
const librarySrc = read("src/pages/MyRubricsPage.jsx");
const panelsSrc = read("src/components/pybotclass/ActivityRubricPanels.jsx");
const activitySrc = read("src/pages/ActivityPage.jsx");
const submissionsSrc = read("src/platform/activitySubmissions.js");
const cssSrc = read("src/styles/pybotclass-dashboard.css");
const iaSrc = read("src/platform/uxIaHelpers.js");

const RUBRIC_I18N = [
  "pcNavRubrics",
  "pcMyRubrics",
  "pcRubricsPageLead",
  "pcNewRubric",
  "pcCreateRubric",
  "pcRubricsEmptyTitle",
  "pcRubricsEmptyDesc",
  "pcManageRubrics",
  "pcRubricChoiceNone",
  "pcRubricChoiceFromMine",
  "pcRubricChoiceCreateForActivity",
  "pcRubricModeQualitative",
  "pcRubricModePoints",
  "pcDuplicate",
  "pcDeleteRubric",
];

test("route /dashboard/rubrics exists inside App Routes", () => {
  assert.match(appSrc, /path="\/dashboard\/rubrics"/);
  assert.match(appSrc, /MyRubricsPage/);
});

test("sidebar primary nav includes Rúbricas between Contenido and Comunidad", () => {
  assert.deepEqual([...PRIMARY_NAV_IDS], [
    "home",
    "courses",
    "content",
    "rubrics",
    "community",
    "ide",
  ]);
  assert.match(iaSrc, /"rubrics"/);
  assert.match(sidebarSrc, /id: "rubrics"/);
  assert.match(sidebarSrc, /pcNavRubrics/);
  assert.match(sidebarSrc, /to: "\/dashboard\/rubrics"/);
  assert.match(sidebarSrc, /path\.startsWith\("\/dashboard\/rubrics"\)/);
  assert.match(sidebarSrc, /PRIMARY_NAV_IDS\.includes\(item\.id\)/);
  const contentIdx = sidebarSrc.indexOf('id: "content"');
  const rubricsIdx = sidebarSrc.indexOf('id: "rubrics"');
  const communityIdx = sidebarSrc.indexOf('id: "community"');
  assert.ok(contentIdx > 0 && rubricsIdx > contentIdx && communityIdx > rubricsIdx);
});

test("sidebar rubrics icon is registered", () => {
  assert.match(iconsSrc, /IconRubrics|rubrics:\s*IconRubrics/);
  assert.match(iconsSrc, /rubrics:\s*IconRubrics/);
});

test("library page uses existing P9 list/get/upsert/delete APIs", () => {
  assert.match(librarySrc, /listMyRubricTemplates/);
  assert.match(librarySrc, /getRubricTemplate/);
  assert.match(librarySrc, /upsertRubricTemplate/);
  assert.match(librarySrc, /deleteRubricTemplate/);
  assert.match(librarySrc, /from "\.\.\/platform\/activitySubmissions\.js"/);
  assert.doesNotMatch(librarySrc, /createRubricEngine|second.?rubric.?api/i);
  assert.match(submissionsSrc, /list_my_rubric_templates/);
  assert.match(submissionsSrc, /get_rubric_template/);
  assert.match(submissionsSrc, /upsert_rubric_template/);
  assert.match(submissionsSrc, /delete_rubric_template/);
});

test("library empty state + create CTA", () => {
  assert.match(librarySrc, /pcRubricsEmptyTitle/);
  assert.match(librarySrc, /pcRubricsEmptyDesc/);
  assert.match(librarySrc, /pcCreateRubric/);
  assert.match(librarySrc, /pcNewRubric/);
  assert.match(librarySrc, /openCreate/);
});

test("create qualitative and points templates go through upsertRubricTemplate", () => {
  assert.match(librarySrc, /scoringMode:\s*formMode/);
  assert.match(librarySrc, /templateId:\s*editingId\s*\|\|\s*null/);
  assert.match(panelsSrc, /pcRubricModeQualitative/);
  assert.match(panelsSrc, /pcRubricModePoints/);
  assert.match(panelsSrc, /option value="qualitative"/);
  assert.match(panelsSrc, /option value="points"/);
});

test("edit uses upsert with template id; duplicate creates new identity", () => {
  assert.match(librarySrc, /templateId:\s*editingId\s*\|\|\s*null/);
  assert.match(librarySrc, /templateId:\s*null/);
  assert.match(librarySrc, /rubricDuplicateName/);
  assert.equal(rubricDuplicateName("Evaluación oral"), "Evaluación oral (copia)");
  assert.equal(rubricDuplicateName("  ", "Rúbrica"), "Rúbrica (copia)");
});

test("delete confirmation path surfaces backend errors", () => {
  assert.match(librarySrc, /setDeleting/);
  assert.match(librarySrc, /deleteRubricTemplate/);
  assert.match(librarySrc, /pcDeleteRubricQuestion/);
  assert.match(librarySrc, /deleteErr/);
  assert.match(librarySrc, /pcRubricDeleteFail/);
  assert.match(librarySrc, /role="dialog"/);
});

test("library authoring reuses shared P9 criteria editor (no second normalization)", () => {
  assert.match(librarySrc, /RubricTemplateAuthoringForm/);
  assert.match(panelsSrc, /export function RubricCriteriaEditor/);
  assert.match(panelsSrc, /export function RubricTemplateAuthoringForm/);
  assert.match(panelsSrc, /RubricCriteriaEditor/);
  // Activity one-off still uses same editor
  assert.match(panelsSrc, /ActivityRubricAuthoringPanel/);
  assert.match(panelsSrc, /choice === "create"/);
});

test("P9 normalize still authoritative for qualitative/points definitions", () => {
  const qualitative = normalizeRubricDefinition({
    name: "Oral",
    scoring_mode: "qualitative",
    criteria: [
      {
        name: "Claridad",
        levels: [
          { name: "Insuficiente", descriptor: "Confuso" },
          { name: "Logrado", descriptor: "Claro" },
        ],
      },
    ],
  }, { requireName: true });
  assert.equal(qualitative.ok, true);
  assert.equal(qualitative.rubric.scoring_mode, "qualitative");
  assert.equal(qualitative.rubric.criteria[0].levels[0].points, null);

  const points = normalizeRubricDefinition({
    name: "Proyecto",
    scoring_mode: "points",
    criteria: [
      {
        name: "Código",
        levels: [
          { name: "Bajo", points: 2 },
          { name: "Alto", points: 5 },
        ],
      },
      {
        name: "Diseño",
        levels: [
          { name: "Bajo", points: 1 },
          { name: "Alto", points: 3 },
          { name: "Excelente", points: 4 },
        ],
      },
    ],
  }, { requireName: true });
  assert.equal(points.ok, true);
  assert.equal(points.rubric.criteria.length, 2);
  assert.equal(points.rubric.criteria[1].levels.length, 3);
});

test("editing template does not mutate frozen activity snapshot semantics", () => {
  const template = {
    id: "tpl-1",
    name: "Base",
    scoring_mode: "points",
    criteria: [
      {
        name: "A",
        levels: [
          { name: "L1", points: 1 },
          { name: "L2", points: 4 },
        ],
      },
    ],
  };
  const snap = snapshotTemplateToActivityRubric(template, { activityId: "act-1" });
  assert.equal(snap.ok, true);
  const edited = {
    ...template,
    criteria: [
      {
        name: "CHANGED",
        levels: [
          { name: "L1", points: 9 },
          { name: "L2", points: 10 },
        ],
      },
    ],
  };
  const independence = templateEditAffectsSnapshot(snap.activityRubric, edited);
  assert.ok(independence === "content_diverged_but_snapshot_unchanged" || independence === "snapshot_independent");
  assert.equal(snap.activityRubric.criteria[0].name, "A");
  assert.equal(snap.activityRubric.criteria[0].levels[1].points, 4);
});

test("activity applies template through existing P9 snapshot API", () => {
  assert.match(activitySrc, /applyRubricTemplateToActivity/);
  assert.match(submissionsSrc, /apply_rubric_template_to_activity/);
  assert.match(panelsSrc, /onApplyTemplate/);
  assert.match(panelsSrc, /pcRubricChoiceFromMine/);
  assert.match(panelsSrc, /pcRubricApplyToActivity/);
  assert.match(activitySrc, /ActivityEvaluationSection/);
});

test("activity preserves no-rubric and one-off authoring paths", () => {
  assert.match(panelsSrc, /pcRubricChoiceNone/);
  assert.match(panelsSrc, /pcRubricChoiceCreateForActivity/);
  assert.match(panelsSrc, /onClearRubric/);
  assert.match(panelsSrc, /onSaveActivityRubric/);
  assert.match(activitySrc, /clearActivityRubric/);
  assert.match(activitySrc, /upsertActivityRubric/);
  assert.match(activitySrc, /ActivityEvaluationSection/);
});

test("activity has discoverable path to manage reusable rubrics", () => {
  assert.match(panelsSrc, /pcManageRubrics/);
  assert.match(panelsSrc, /to="\/dashboard\/rubrics"/);
  assert.match(panelsSrc, /Link/);
  const evalSrc = read("src/components/pybotclass/ActivityEvaluationSection.jsx");
  assert.match(evalSrc, /pcManageRubrics/);
  assert.match(evalSrc, /\/dashboard\/rubrics/);
});

test("grading remains on ActivityPage (not moved to library)", () => {
  assert.match(activitySrc, /ActivityRubricGradeMatrix/);
  assert.doesNotMatch(librarySrc, /ActivityRubricGradeMatrix|gradeSubmission/);
  assert.match(librarySrc, /PyBotClassLayout/);
});

test("library uses PyBotClass layout + responsive / theme-safe classes", () => {
  assert.match(librarySrc, /PyBotClassLayout/);
  assert.match(librarySrc, /pbc-content-page|pbc-rubrics-page/);
  assert.match(librarySrc, /pbc-content-card|pbc-rubric-card/);
  assert.match(cssSrc, /\.pbc-rubrics-grid/);
  assert.match(cssSrc, /\.pbc-rubric-choice/);
  assert.match(cssSrc, /@media \(max-width: 720px\)[\s\S]*\.pbc-rubric-card/);
  assert.match(cssSrc, /data-pbc-theme="dark"[\s\S]*\.pbc-rubric-library-editor/);
});

test("i18n rubric keys present in all languages", () => {
  for (const lang of SUPPORTED_LANGS) {
    const bag = PYBOTCLASS_STRINGS[lang];
    for (const key of RUBRIC_I18N) {
      assert.equal(typeof bag[key], "string", `${lang}.${key}`);
      assert.ok(bag[key].length > 0, `${lang}.${key}`);
    }
  }
  assert.equal(PYBOTCLASS_STRINGS.es.pcNavRubrics, "Rúbricas");
  assert.equal(PYBOTCLASS_STRINGS.es.pcMyRubrics, "Mis rúbricas");
});

test("no migration added or historical P9 SQL modified for this UX", () => {
  const migrationsDir = resolve(root, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const newerThanP9 = files.filter((f) => f > "20261002160000_p9_generic_multidimensional_rubrics.sql");
  // UX-only task: no new migration after baseline P9 file is required.
  // Allow unrelated newer migrations that already existed; assert we did not add rubric-library schema.
  for (const f of newerThanP9) {
    const body = read(`supabase/migrations/${f}`);
    assert.doesNotMatch(body, /rubric_library|create table.*rubric_templates/i);
  }
  const p9 = read("supabase/migrations/20261002160000_p9_generic_multidimensional_rubrics.sql");
  assert.match(p9, /list_my_rubric_templates/);
  assert.match(p9, /apply_rubric_template_to_activity/);
});
