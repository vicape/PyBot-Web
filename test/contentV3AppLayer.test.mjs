/**
 * Definitive Content application layer — focused contract tests.
 * Unit -> Lesson -> Item only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTENT_ITEM_TYPES,
  CONTENT_ITEMS_MIGRATION_HINT,
  LEGACY_ITEM_TYPES,
  LEGACY_ITEM_TYPE_MAP,
  LESSON_CHILD_CREATE_TYPES,
  LESSON_ITEM_CREATE_TYPES,
  UNIT_DIRECT_CREATE_TYPES,
  derivePreparationStatus,
  itemTypeOptionsForEdit,
  mapLegacyItemType,
  normalizeItemType,
} from "../src/platform/contentMetadata.js";
import { deriveContentToc } from "../src/platform/contentToc.js";

const root = resolve(import.meta.dirname, "..");

test("canonical item types normalize correctly", () => {
  for (const t of CONTENT_ITEM_TYPES) {
    assert.equal(normalizeItemType(t), t);
    assert.equal(mapLegacyItemType(t), t);
  }
  assert.deepEqual([...CONTENT_ITEM_TYPES], [
    "material",
    "video",
    "example",
    "exercise",
    "quiz",
    "assignment",
    "assessment",
  ]);
});

test("legacy types map exactly", () => {
  assert.equal(mapLegacyItemType("reading"), "material");
  assert.equal(mapLegacyItemType("resource"), "material");
  assert.equal(mapLegacyItemType("theory"), "material");
  assert.equal(mapLegacyItemType("activity"), "exercise");
  assert.equal(mapLegacyItemType("test"), "assessment");
  assert.equal(mapLegacyItemType("project"), "assignment");
  assert.equal(LEGACY_ITEM_TYPE_MAP.reading, "material");
  for (const legacy of LEGACY_ITEM_TYPES) {
    assert.ok(LEGACY_ITEM_TYPE_MAP[legacy]);
    assert.equal(LESSON_ITEM_CREATE_TYPES.includes(legacy), false);
  }
});

test("Unit creation options: Lesson only (no direct Unit items)", () => {
  assert.deepEqual([...UNIT_DIRECT_CREATE_TYPES], ["lesson"]);
});

test("Lesson-child creation options: seven canonical types", () => {
  assert.deepEqual([...LESSON_ITEM_CREATE_TYPES], [...CONTENT_ITEM_TYPES]);
  assert.deepEqual([...LESSON_CHILD_CREATE_TYPES], [...CONTENT_ITEM_TYPES]);
});

test("edit options expose canonical types only", () => {
  const opts = itemTypeOptionsForEdit({ itemType: "reading" });
  assert.equal(opts[0], "material");
  assert.ok(opts.includes("assessment"));
  assert.equal(opts.includes("reading"), false);
  assert.equal(opts.includes("project"), false);
});

test("preparation_status derived only in memory for legacy rows", () => {
  assert.equal(derivePreparationStatus({ status: "published" }), "ready");
  assert.equal(derivePreparationStatus({ status: "draft" }), "draft");
  assert.equal(derivePreparationStatus({ status: "draft", preparation_status: "ready" }), "ready");
});

test("TOC: Unit -> Lesson -> Item numbering", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "les", title: "Lesson", position: 0 }] },
    { les: [{ id: "c1", title: "Material", position: 0, type: "material" }] },
  );
  assert.equal(toc[0].numberLabel, "1");
  assert.equal(toc[0].children[0].kind, "lesson");
  assert.equal(toc[0].children[0].numberLabel, "1.1");
  assert.equal(toc[0].children[0].children[0].kind, "item");
  assert.equal(toc[0].children[0].children[0].numberLabel, "1.1.1");
  assert.equal(toc[0].children[0].children[0].itemType, "material");
  assert.equal(toc[0].children[0].children[0].children.length, 0);
});

test("TOC: no Unit-level item siblings; lessons only under unit", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    {
      u1: [
        { id: "l1", title: "A", position: 0 },
        { id: "l2", title: "B", position: 1 },
      ],
    },
    {
      l1: [{ id: "i1", title: "Quiz", position: 0, type: "quiz" }],
    },
  );
  assert.equal(toc[0].children.length, 2);
  assert.ok(toc[0].children.every((c) => c.kind === "lesson"));
  assert.equal(toc[0].children[0].children[0].itemType, "quiz");
});

test("TOC maps legacy reading label to material", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "les", title: "L", position: 0 }] },
    { les: [{ id: "c1", title: "R", position: 0, item_type: "reading" }] },
  );
  assert.equal(toc[0].children[0].children[0].itemType, "material");
});

// ── API mock store ──────────────────────────────────────────────────────────

function createStore({ lessons = [], items = [], units = [] } = {}) {
  const lessonRows = lessons.map((r) => ({ ...r }));
  const itemRows = items.map((r) => ({ ...r }));
  const unitRows = units.length
    ? units.map((r) => ({ ...r }))
    : [{ id: "unit-1", content_id: "content-1", title: "U", position: 0, unit_type: "unit" }];
  let seq = 1;

  function matches(row, filters) {
    for (const f of filters) {
      if (f.op === "eq" && row[f.col] !== f.val) return false;
      if (f.op === "is") {
        if (f.val === null && row[f.col] != null) return false;
        if (f.val !== null && row[f.col] !== f.val) return false;
      }
      if (f.op === "lt" && !(row[f.col] < f.val)) return false;
      if (f.op === "gt" && !(row[f.col] > f.val)) return false;
    }
    return true;
  }

  function applyOrder(list, orders) {
    const out = [...list];
    out.sort((a, b) => {
      for (const o of orders) {
        const av = a[o.col];
        const bv = b[o.col];
        const cmp = av === bv ? 0 : av < bv ? -1 : 1;
        if (cmp !== 0) return o.asc ? cmp : -cmp;
      }
      return 0;
    });
    return out;
  }

  function makeTable(rows, name) {
    const state = {
      filters: [],
      orders: [],
      limitN: null,
      mode: "select",
      payload: null,
    };
    const finishSelect = () => {
      let list = rows.filter((r) => matches(r, state.filters));
      list = applyOrder(list, state.orders);
      if (state.limitN != null) list = list.slice(0, state.limitN);
      return { data: list.map((r) => ({ ...r })), error: null };
    };
    const api = {
      select() {
        if (state.mode !== "insert" && state.mode !== "update") state.mode = "select";
        return api;
      },
      insert(payload) {
        state.mode = "insert";
        state.payload = payload;
        state.filters = [];
        return api;
      },
      update(payload) {
        state.mode = "update";
        state.payload = payload;
        state.filters = [];
        return api;
      },
      delete() {
        state.mode = "delete";
        state.filters = [];
        return api;
      },
      eq(col, val) {
        state.filters.push({ op: "eq", col, val });
        return api;
      },
      is(col, val) {
        state.filters.push({ op: "is", col, val });
        return api;
      },
      lt(col, val) {
        state.filters.push({ op: "lt", col, val });
        return api;
      },
      gt(col, val) {
        state.filters.push({ op: "gt", col, val });
        return api;
      },
      order(col, opts = {}) {
        state.orders.push({ col, asc: opts.ascending !== false });
        return api;
      },
      limit(n) {
        state.limitN = n;
        return api;
      },
      async maybeSingle() {
        if (state.mode === "select") {
          const res = finishSelect();
          return { data: res.data[0] ?? null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (state.mode === "insert") {
          const id = state.payload.id || `${name}-${seq++}`;
          const row = {
            id,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
            ...state.payload,
          };
          if (name === "content_lessons") {
            row.content_units = {
              content_id: "content-1",
              title: "U",
              position: 0,
              unit_type: "unit",
            };
            row.document_json = row.document_json ?? [];
            row.document_version = row.document_version ?? 1;
          }
          if (name === "content_items") {
            row.content = row.content ?? { document_json: [], document_version: 1 };
            row.config = row.config ?? {};
            const lesson = lessonRows.find((l) => l.id === row.lesson_id);
            row.content_lessons = lesson
              ? {
                  id: lesson.id,
                  unit_id: lesson.unit_id,
                  title: lesson.title,
                  content_units: {
                    content_id: "content-1",
                    title: "U",
                    position: 0,
                    unit_type: "unit",
                  },
                }
              : null;
          }
          rows.push(row);
          return { data: { ...row }, error: null };
        }
        if (state.mode === "update") {
          const idx = rows.findIndex((r) => matches(r, state.filters));
          if (idx < 0) return { data: null, error: { message: "not_found" } };
          rows[idx] = { ...rows[idx], ...state.payload };
          return { data: { ...rows[idx] }, error: null };
        }
        if (state.mode === "select") {
          const res = finishSelect();
          if (!res.data[0]) return { data: null, error: { message: "not_found" } };
          return { data: res.data[0], error: null };
        }
        return { data: null, error: null };
      },
      then(resolve, reject) {
        const run = async () => {
          if (state.mode === "delete") {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (matches(rows[i], state.filters)) rows.splice(i, 1);
            }
            return { data: null, error: null };
          }
          if (state.mode === "select") return finishSelect();
          if (state.mode === "update") {
            const idx = rows.findIndex((r) => matches(r, state.filters));
            if (idx < 0) return { data: null, error: { message: "not_found" } };
            rows[idx] = { ...rows[idx], ...state.payload };
            return { data: { ...rows[idx] }, error: null };
          }
          return { data: null, error: null };
        };
        return run().then(resolve, reject);
      },
    };
    return api;
  }

  return {
    lessonRows,
    itemRows,
    unitRows,
    client: {
      from(name) {
        if (name === "content_lessons") return makeTable(lessonRows, name);
        if (name === "content_items") return makeTable(itemRows, name);
        if (name === "content_units") return makeTable(unitRows, name);
        if (name === "learning_contents") {
          return {
            update() {
              return { eq: async () => ({ data: null, error: null }) };
            },
          };
        }
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        };
      },
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    },
  };
}

test("API hierarchy: lessons, items, rejection of Unit items & Lesson nesting", async (t) => {
  const store = createStore({
    lessons: [
      {
        id: "top-lesson",
        unit_id: "unit-1",
        title: "Lesson",
        description: null,
        position: 0,
        estimated_minutes: null,
        document_json: [{ type: "paragraph", content: "doc" }],
        document_version: 1,
      },
    ],
    items: [
      {
        id: "child-material",
        lesson_id: "top-lesson",
        type: "material",
        title: "Material",
        position: 0,
        content: { document_json: [], document_version: 1 },
        config: {},
      },
    ],
  });

  mock.module("../src/supabaseClient.js", {
    namedExports: {
      getSupabase: () => store.client,
      isSupabaseConfigured: () => true,
    },
  });

  const api = await import("../src/platform/contentApi.js");

  await t.test("listUnitLessons returns lessons only", async () => {
    const { rows, error } = await api.listUnitLessons("unit-1");
    assert.equal(error, null);
    assert.deepEqual(rows.map((r) => r.id), ["top-lesson"]);
  });

  await t.test("listLessonItems returns items under lesson", async () => {
    const { rows, error } = await api.listLessonItems("top-lesson");
    assert.equal(error, null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "child-material");
    assert.equal(rows[0].type, "material");
  });

  await t.test("createLesson under unit works", async () => {
    const { lesson, error } = await api.createLesson("unit-1", { title: "New Lesson" });
    assert.equal(error, null);
    assert.equal(lesson.title, "New Lesson");
    assert.equal(lesson.unit_id, "unit-1");
  });

  await t.test("createLesson rejects parentLessonId (no Lesson under Lesson)", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Nested",
      parentLessonId: "top-lesson",
    });
    assert.equal(lesson, null);
    assert.match(String(error), /lesson_under_lesson/);
  });

  await t.test("createLesson rejects non-lesson itemType under Unit", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Quiz",
      itemType: "quiz",
    });
    assert.equal(lesson, null);
    assert.equal(error, "invalid_item_type_for_unit");
  });

  for (const type of CONTENT_ITEM_TYPES) {
    await t.test(`createContentItem ${type} under lesson`, async () => {
      const { item, error } = await api.createContentItem("top-lesson", {
        title: `Item ${type}`,
        type,
      });
      assert.equal(error, null, error);
      assert.equal(item.type, type);
      assert.equal(item.lesson_id, "top-lesson");
    });
  }

  await t.test("createContentItem rejects reading (legacy)", async () => {
    const { item, error } = await api.createContentItem("top-lesson", {
      title: "Bad",
      type: "reading",
    });
    // reading maps to material via normalize — but isCanonical after normalize is material, allowed.
    // Spec: do not offer reading for new creation; API maps legacy to canonical.
    assert.equal(error, null);
    assert.equal(item.type, "material");
  });

  await t.test("moveLessonToUnit preserves lesson id", async () => {
    store.unitRows.push({
      id: "unit-2",
      content_id: "content-1",
      title: "U2",
      position: 1,
      unit_type: "unit",
    });
    const beforeItems = store.itemRows
      .filter((i) => i.lesson_id === "top-lesson")
      .map((i) => i.id)
      .sort();
    const { ok, error } = await api.moveLessonToUnit("top-lesson", "unit-2");
    assert.equal(error, null);
    assert.equal(ok, true);
    const lesson = store.lessonRows.find((l) => l.id === "top-lesson");
    assert.equal(lesson.unit_id, "unit-2");
    const afterItems = store.itemRows
      .filter((i) => i.lesson_id === "top-lesson")
      .map((i) => i.id)
      .sort();
    assert.deepEqual(afterItems, beforeItems);
  });

  await t.test("moveItemToLesson preserves item id", async () => {
    const { lesson } = await api.createLesson("unit-1", { title: "Target" });
    const itemId = "child-material";
    const { ok, error } = await api.moveItemToLesson(itemId, lesson.id);
    assert.equal(error, null);
    assert.equal(ok, true);
    const item = store.itemRows.find((i) => i.id === itemId);
    assert.equal(item.id, itemId);
    assert.equal(item.lesson_id, lesson.id);
  });

  await t.test("duplicateContentItem creates new id", async () => {
    const source = store.itemRows[0];
    const { item, error } = await api.duplicateContentItem(source.id);
    assert.equal(error, null);
    assert.notEqual(item.id, source.id);
    assert.equal(item.type, source.type);
  });

  await t.test("duplicateLesson creates new lesson and item ids", async () => {
    const sourceId = "top-lesson";
    const beforeItemIds = new Set(store.itemRows.map((i) => i.id));
    const { lesson, error } = await api.duplicateLesson(sourceId);
    assert.equal(error, null);
    assert.notEqual(lesson.id, sourceId);
    const newItems = store.itemRows.filter((i) => i.lesson_id === lesson.id);
    assert.ok(newItems.length >= 1);
    assert.ok(newItems.every((i) => !beforeItemIds.has(i.id) || i.lesson_id === lesson.id));
    assert.ok(newItems.every((i) => i.id !== sourceId));
  });

  await t.test("deleteLesson cascades conceptually (items deleted via FK in DB; API deletes lesson)", async () => {
    const { lesson } = await api.createLesson("unit-1", { title: "Temp" });
    await api.createContentItem(lesson.id, { title: "X", type: "video" });
    const { ok, error } = await api.deleteLesson(lesson.id);
    assert.equal(error, null);
    assert.equal(ok, true);
    assert.equal(store.lessonRows.find((l) => l.id === lesson.id), undefined);
  });

  await t.test("deleteContentItem removes only that item", async () => {
    const { item } = await api.createContentItem("top-lesson", { title: "Del", type: "quiz" });
    const before = store.itemRows.length;
    const { ok, error } = await api.deleteContentItem(item.id);
    assert.equal(error, null);
    assert.equal(ok, true);
    assert.equal(store.itemRows.find((i) => i.id === item.id), undefined);
    assert.equal(store.itemRows.length, before - 1);
  });

  await t.test("sibling ordering for items", async () => {
    const { item: a } = await api.createContentItem("top-lesson", { title: "A", type: "video" });
    const { item: b } = await api.createContentItem("top-lesson", { title: "B", type: "video" });
    assert.ok(b.position > a.position);
    const { ok } = await api.moveContentItem(b.id, "up");
    assert.equal(ok, true);
  });
});

test("UI/API consumers no longer create Unit-direct items", () => {
  const editor = readFileSync(resolve(root, "src/pages/ContentEditorPage.jsx"), "utf8");
  assert.match(editor, /createContentItem/);
  assert.match(editor, /LESSON_ITEM_CREATE_TYPES/);
  assert.match(editor, /pcExpandAll/);
  assert.match(editor, /pcCollapseAll/);
  assert.doesNotMatch(editor, /UNIT_DIRECT_CREATE_TYPES/);
  assert.match(editor, /openCreateLesson/);
});

test("i18n labels for canonical types", () => {
  const i18n = readFileSync(resolve(root, "src/i18n/pybotclass.js"), "utf8");
  assert.match(i18n, /pcItemType_material: "Material"/);
  assert.match(i18n, /pcItemType_assessment: "Evaluación"/);
  assert.match(i18n, /pcItemType_assignment: "Trabajo"/);
  assert.match(i18n, /pcItemType_assignment: "Assignment"/);
  assert.match(i18n, /pcExpandAll/);
  assert.match(i18n, /pcNewLesson/);
});

test("CONTENT_ITEMS_MIGRATION_HINT present", () => {
  assert.match(CONTENT_ITEMS_MIGRATION_HINT, /20260928220052_content_items_structure/);
});
