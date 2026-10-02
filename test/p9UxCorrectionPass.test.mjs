/**
 * P9 UX correction pass — five verified gaps (issue instructions exact).
 * STARTING BASELINE HEAD: 0c91e35f5c087cada48fc6c60c62803664c7bac3
 * PROFILE: INTEGRATION
 * No SQL / migration / MaxPlay / redesign.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  selectionFromActivityRubric,
  selectionFromTemplate,
} from "../src/platform/activityEvaluation.js";

const root = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const PROFILE = "INTEGRATION";

const formSrc = read("src/components/pybotclass/CourseActivitiesTab.jsx");
const evalSrc = read("src/components/pybotclass/ActivityEvaluationSection.jsx");
const activitySrc = read("src/pages/ActivityPage.jsx");
const librarySrc = read("src/pages/MyRubricsPage.jsx");
const coursePageSrc = read("src/pages/PyBotClassCoursePage.jsx");
const helpersSrc = read("src/platform/activityEvaluation.js");

test("PROFILE exactly INTEGRATION", () => {
  assert.equal(PROFILE, "INTEGRATION");
});

test("Gap1: max points lives inside ActivityEvaluationSection Evaluación block", () => {
  assert.match(evalSrc, /id="act-points"/);
  assert.match(evalSrc, /showMaxPointsField/);
  assert.match(evalSrc, /pcMaxPoints/);
  assert.match(formSrc, /showMaxPointsField/);
  assert.match(formSrc, /ActivityEvaluationSection/);
  // Standalone max field removed from ActivityForm; only via Evaluación section.
  assert.doesNotMatch(formSrc, /id="act-points"/);
  const dueIdx = formSrc.indexOf("act-due");
  const evalIdx = formSrc.indexOf("<ActivityEvaluationSection");
  const starterIdx = formSrc.indexOf("act-starter");
  assert.ok(dueIdx > 0 && evalIdx > dueIdx && starterIdx > evalIdx);
  assert.match(evalSrc, /pbc-eval-section/);
});

test("Gap2: ownCopy only for factual loaded activity rubric (staged vs persisted)", () => {
  const staged = selectionFromTemplate({
    id: "tpl-1",
    name: "Plantilla",
    scoring_mode: "points",
    criteria: [{ name: "C", levels: [{ name: "L", points: 3 }] }],
  });
  assert.equal(staged.ownCopy, false);

  const persisted = selectionFromActivityRubric({
    rubric: { scoring_mode: "points", source_template_id: "tpl-1" },
    criteria: [{ name: "C", levels: [{ name: "L", points: 3 }] }],
    templateName: "Plantilla",
  });
  assert.equal(persisted.ownCopy, true);

  assert.match(helpersSrc, /ownCopy: false/);
  assert.match(evalSrc, /ownCopy: false/);
  assert.match(evalSrc, /selection\.ownCopy \?/);
  assert.doesNotMatch(evalSrc, /selection\.ownCopy \|\| selection\.mode === "oneoff"/);
});

test("Gap3: persistEvaluation failure-safe max restore", () => {
  assert.match(activitySrc, /originalMax/);
  assert.match(activitySrc, /maxUpdatedTo/);
  assert.match(activitySrc, /max_points: originalMax/);
  assert.match(activitySrc, /maxErr/);
  // Never leave max changed while rubric change failed.
  const fnStart = activitySrc.indexOf("const persistEvaluation = async");
  const fnBody = activitySrc.slice(fnStart, fnStart + 2200);
  assert.match(fnBody, /originalMax/);
  assert.match(fnBody, /maxUpdatedTo/);
  assert.match(fnBody, /update\(\{ max_points: originalMax \}\)/);
  assert.ok(fnBody.indexOf("maxUpdatedTo") < fnBody.indexOf("clearActivityRubric") ||
    fnBody.indexOf("originalMax") < fnBody.indexOf("applyRubricTemplateToActivity"));
});

test("Gap4: library Editar actividad opens ActivityForm edit query route", () => {
  assert.match(
    librarySrc,
    /\/dashboard\/classes\/\$\{applyMismatch\.courseId\}\?tab=actividades&edit=\$\{applyMismatch\.activityId\}/,
  );
  assert.doesNotMatch(librarySrc, /to=\{`\/actividad\/\$\{applyMismatch\.activityId\}`\}/);
  assert.match(coursePageSrc, /editActivityId/);
  assert.match(coursePageSrc, /searchParams\.get\("edit"\)/);
  assert.match(formSrc, /editActivityId/);
  assert.match(formSrc, /onEditOpened/);
  assert.match(formSrc, /openEdit/);
});

test("Gap5: library blocks null/non-finite max; shows sin definir; never changes max", () => {
  assert.match(librarySrc, /sin definir/);
  assert.match(librarySrc, /!Number\.isFinite\(max\)/);
  assert.match(librarySrc, /max == null \|\| !Number\.isFinite\(max\)/);
  assert.doesNotMatch(librarySrc, /\.update\(\s*\{\s*max_points/);
  assert.doesNotMatch(librarySrc, /max_points:\s*ceiling/);
});

test("no SQL or migration added by correction pass", () => {
  const migrationsDir = resolve(root, "supabase/migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  assert.ok(!files.some((f) => /p9_ux|correction|evaluation_gap/i.test(f)));
  const newer = files.filter((f) => f > "20261002160000_p9_generic_multidimensional_rubrics.sql");
  for (const f of newer) {
    const body = read(`supabase/migrations/${f}`);
    assert.doesNotMatch(body, /p9_ux_correction|evaluation_gap/i);
  }
});
