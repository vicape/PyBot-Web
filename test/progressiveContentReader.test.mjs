/**
 * Progressive disclosure reader for multi-lesson assigned/shared content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSnapshotReaderModel,
  findLessonIndex,
} from "../src/platform/contentSnapshotReader.js";
import { PYBOTCLASS_STRINGS } from "../src/i18n/pybotclass.js";
import { SUPPORTED_LANGS } from "../src/i18n.js";

const root = resolve(import.meta.dirname, "..");
const viewerSrc = readFileSync(
  resolve(root, "src/components/content-editor/AssignedContentSnapshotViewer.jsx"),
  "utf8",
);
const sharedSrc = readFileSync(resolve(root, "src/pages/SharedContentPage.jsx"), "utf8");
const cssSrc = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");

const contentSnapshot = {
  sourceType: "content",
  sourceId: "c1",
  title: "Curso Python",
  description: "Introducción",
  units: [
    {
      id: "u1",
      title: "Unidad A",
      position: 0,
      unitType: "chapter",
      estimatedMinutes: 30,
      lessons: [
        {
          id: "l1",
          title: "Lección 1",
          position: 0,
          itemType: "lesson",
          estimatedMinutes: 10,
          document_json: [{ id: "b1", type: "paragraph", content: [] }],
        },
        {
          id: "l2",
          title: "Lección 2",
          position: 1,
          itemType: "theory",
          estimatedMinutes: 15,
          document_json: [{ id: "b2", type: "paragraph", content: [] }],
        },
      ],
    },
    {
      id: "u2",
      title: "Unidad B",
      position: 1,
      unitType: "unit",
      lessons: [
        {
          id: "l3",
          title: "Lección 3",
          position: 0,
          itemType: "activity",
          document_json: [{ id: "b3", type: "paragraph", content: [] }],
        },
      ],
    },
  ],
};

const unitSnapshot = {
  sourceType: "unit",
  sourceId: "u1",
  title: "Solo unidad",
  description: "Desc",
  unitType: "unit",
  estimatedMinutes: 20,
  lessons: [
    {
      id: "a",
      title: "A",
      position: 1,
      itemType: "lesson",
      document_json: [{ id: "x", type: "paragraph", content: [] }],
    },
    {
      id: "b",
      title: "B",
      position: 0,
      itemType: "quiz",
      estimatedMinutes: 5,
      document_json: [{ id: "y", type: "paragraph", content: [] }],
    },
  ],
};

test("content model: ordered lessons follow unit then lesson order; overview units omit documents", () => {
  const model = buildSnapshotReaderModel(contentSnapshot);
  assert.equal(model.mode, "multi");
  assert.equal(model.sourceType, "content");
  assert.deepEqual(
    model.orderedLessons.map((l) => l.id),
    ["l1", "l2", "l3"],
  );
  assert.equal(model.orderedLessons[1].unitId, "u1");
  assert.equal(model.orderedLessons[2].unitId, "u2");
  assert.equal(model.orderedLessons[2].unitTitle, "Unidad B");
  assert.equal(model.orderedLessons[0].flatIndex, 0);
  assert.equal(model.orderedLessons[2].flatIndex, 2);

  // Overview unit lesson rows are metadata-only (no document_json)
  for (const unit of model.units) {
    for (const lesson of unit.lessons) {
      assert.equal("document_json" in lesson, false);
      assert.ok(lesson.title);
      assert.ok(lesson.itemType);
    }
  }
});

test("content next/previous crosses unit boundaries in pedagogical order", () => {
  const model = buildSnapshotReaderModel(contentSnapshot);
  const idx = findLessonIndex(model.orderedLessons, "l2");
  assert.equal(idx, 1);
  assert.equal(model.orderedLessons[idx - 1].id, "l1");
  assert.equal(model.orderedLessons[idx + 1].id, "l3");
  assert.equal(model.orderedLessons[idx + 1].unitId, "u2");
});

test("unit model: previous/next stay within assigned unit; position sort preserved", () => {
  const model = buildSnapshotReaderModel(unitSnapshot);
  assert.equal(model.mode, "multi");
  assert.equal(model.sourceType, "unit");
  assert.equal(model.units.length, 1);
  assert.deepEqual(
    model.orderedLessons.map((l) => l.id),
    ["b", "a"],
  );
  assert.ok(model.orderedLessons.every((l) => l.unitId === "u1"));
  assert.equal(findLessonIndex(model.orderedLessons, "missing"), -1);
});

test("single-item snapshots stay in single mode (no forced overview)", () => {
  assert.equal(buildSnapshotReaderModel({ sourceType: "lesson", sourceId: "x" }).mode, "single");
  assert.equal(buildSnapshotReaderModel({ sourceType: "exercise", sourceId: "x" }).mode, "single");
  assert.equal(buildSnapshotReaderModel({ sourceType: "task", sourceId: "x" }).mode, "single");
});

test('AC1: For sourceType="content" and sourceType="unit", default view does not render all lesson documents', () => {
  assert.match(viewerSrc, /ProgressiveMultiLessonReader/);
  assert.match(viewerSrc, /buildSnapshotReaderModel/);
  assert.match(viewerSrc, /pbc-content-reader--overview/);
  assert.match(viewerSrc, /pcViewStructure/);
  assert.match(viewerSrc, /pcPrevious/);
  assert.match(viewerSrc, /pcLessonPosition/);
  assert.match(viewerSrc, /aria-expanded/);
  assert.match(viewerSrc, /aria-current/);
  // Contract phrase from AC1 / TARGET EXPERIENCE
  assert.match(
    viewerSrc,
    /sourceType="content" and sourceType="unit"/,
  );

  // Default multi path must not map all lessons to ReadOnlyDoc
  assert.doesNotMatch(
    viewerSrc,
    /type === "content"[\s\S]*units[\s\S]*\.map\([\s\S]*ReadOnlyDoc/,
  );
  assert.doesNotMatch(
    viewerSrc,
    /type === "unit"[\s\S]*lessons[\s\S]*\.map\([\s\S]*ReadOnlyDoc/,
  );

  // Exactly one ReadOnlyDoc in lesson mode path (selected lesson only)
  const lessonModeBlock = viewerSrc.match(
    /function LessonMode[\s\S]*?function ProgressiveMultiLessonReader/,
  );
  assert.ok(lessonModeBlock, "LessonMode must exist");
  const readOnlyInLessonMode = lessonModeBlock[0].match(/<ReadOnlyDoc/g) || [];
  assert.equal(readOnlyInLessonMode.length, 1);

  // Single-item preservation
  assert.match(viewerSrc, /type === "lesson"/);
  assert.match(viewerSrc, /type === "exercise" \|\| type === "task"/);
  assert.match(viewerSrc, /BlockCard/);
});

test("no fake progress/completion/read telemetry in reader", () => {
  assert.doesNotMatch(viewerSrc, /markAsRead|lessonCompleted|completionPercent|timeOnPage|pcProgress|pcCompleted|pcPercentRead/);
  assert.doesNotMatch(viewerSrc, /checkmark|percent complete|% complete/i);
  const modelSrc = readFileSync(resolve(root, "src/platform/contentSnapshotReader.js"), "utf8");
  assert.doesNotMatch(modelSrc, /markAsRead|lessonCompleted|completionPercent|timeOnPage/);
});

test("SharedContentPage uses progressive viewer; no scroll-to-anchor TOC reader", () => {
  assert.match(sharedSrc, /AssignedContentSnapshotViewer/);
  assert.doesNotMatch(sharedSrc, /ContentTableOfContents/);
  assert.doesNotMatch(sharedSrc, /scrollIntoView/);
  assert.doesNotMatch(sharedSrc, /onTocNavigate/);
  assert.match(sharedSrc, /pcCreateCopy/);
  assert.match(sharedSrc, /pcAssignAsIs/);
  assert.match(sharedSrc, /pcReadOnlyShared/);
  assert.match(sharedSrc, /owner_id === user\.id/);
});

test("responsive contract: Design C on-demand index, no permanent local rail", () => {
  assert.match(cssSrc, /\.pbc-content-reader__layout/);
  assert.match(cssSrc, /\.pbc-content-reader__nav--drawer/);
  assert.match(cssSrc, /\.pbc-content-reader__index-backdrop/);
  assert.match(cssSrc, /\.pbc-content-reader__nav-toggle/);
  assert.match(cssSrc, /\.pbc-content-reader__header-meta/);
  assert.match(cssSrc, /-webkit-line-clamp:\s*2/);
  assert.match(cssSrc, /@media \(max-width: 1024px\)/);
  assert.match(cssSrc, /@media \(max-width: 900px\)/);
  assert.match(cssSrc, /@media \(max-width: 768px\)/);
  assert.match(cssSrc, /max-width:\s*46rem/);
  // Permanent dual-column local rail must not remain the desktop default
  assert.doesNotMatch(cssSrc, /\.pbc-content-reader__layout\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*240px\)/);
  assert.match(viewerSrc, /pcTocTitle/);
  assert.match(viewerSrc, /indexOpen/);
  assert.match(viewerSrc, /pcInThisLessonLearn/);
  assert.match(sharedSrc, /pbc-shared-content__secondary-actions/);
  assert.match(sharedSrc, /pbc-shared-content__title-row/);
  assert.match(sharedSrc, /pcMoreOptions/);
});

test("AC1 structure access: single primary control; overview return demoted into panel", () => {
  const lessonModeBlock = viewerSrc.match(
    /function LessonMode[\s\S]*?function ProgressiveMultiLessonReader/,
  );
  assert.ok(lessonModeBlock, "LessonMode must exist");
  const headerBlock = lessonModeBlock[0].match(
    /className="pbc-content-reader__header"[\s\S]*?<\/header>/,
  );
  assert.ok(headerBlock, "lesson header must exist");
  // Exactly one structure toggle in the reading header
  assert.equal((headerBlock[0].match(/pcViewStructure/g) || []).length, 1);
  assert.doesNotMatch(headerBlock[0], /pcTocTitle/);
  // Competing primary "Índice" must not sit beside "Ver estructura" in the header
  assert.equal((headerBlock[0].match(/pbc-content-reader__nav-toggle/g) || []).length, 1);
  assert.doesNotMatch(headerBlock[0], /pbc-content-reader__back/);
  // Return-to-overview preserved inside the structure panel
  assert.match(lessonModeBlock[0], /onBackToOverview=\{onBack\}/);
  assert.match(viewerSrc, /onBackToOverview/);
  assert.match(cssSrc, /\.pbc-shared-content__title-row/);
  assert.match(cssSrc, /\.pbc-content-reader__header-meta/);
});

test("reader i18n keys present in every supported language", () => {
  const keys = [
    "pcStartLesson",
    "pcPrevious",
    "pcViewStructure",
    "pcLessonPosition",
    "pcReaderOutline",
    "pcInThisLessonLearn",
    "pcNoContentToShow",
    "pcTocTitle",
  ];
  for (const lang of SUPPORTED_LANGS) {
    for (const key of keys) {
      assert.equal(typeof PYBOTCLASS_STRINGS[lang][key], "string", `${lang}.${key}`);
      assert.ok(PYBOTCLASS_STRINGS[lang][key].length > 0, `${lang}.${key}`);
    }
  }
  assert.match(PYBOTCLASS_STRINGS.es.pcLessonPosition, /\{n\}/);
  assert.match(PYBOTCLASS_STRINGS.es.pcLessonPosition, /\{total\}/);
});

test("objectives helper only when real data exists; teacher actions secondary", () => {
  assert.match(viewerSrc, /resolveLearningObjectives/);
  assert.match(viewerSrc, /learning_objectives/);
  assert.match(viewerSrc, /pcInThisLessonLearn/);
  assert.doesNotMatch(viewerSrc, /En esta lección aprenderás/);
  assert.match(sharedSrc, /pbc-shared-content__actions-menu/);
  assert.match(sharedSrc, /role="menu"/);
  assert.match(sharedSrc, /pcCreateCopy/);
  assert.match(sharedSrc, /pcAssignAsIs/);
  assert.doesNotMatch(
    sharedSrc,
    /pbc-content-editor__actions[\s\S]*pbc-btn--primary[\s\S]*pcCreateCopy/,
  );
});
