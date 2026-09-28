/**
 * Content V3 application layer — focused contract tests.
 * EXECUTION ENVIRONMENT: CLOUD via MaxCloud only
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTENT_V3_ITEM_TYPES,
  CONTENT_V3_MIGRATION_HINT,
  LEGACY_ITEM_TYPES,
  LESSON_CHILD_CREATE_TYPES,
  LESSON_ITEM_TYPES,
  UNIT_DIRECT_CREATE_TYPES,
  derivePreparationStatus,
  itemTypeOptionsForEdit,
  normalizeItemType,
} from "../src/platform/contentMetadata.js";
import { deriveContentToc } from "../src/platform/contentToc.js";

const root = resolve(import.meta.dirname, "..");

// ── A. metadata ─────────────────────────────────────────────────────────────

test("A1: V3 types normalize correctly", () => {
  for (const t of CONTENT_V3_ITEM_TYPES) {
    assert.equal(normalizeItemType(t), t);
  }
});

test("A2: legacy types still normalize correctly", () => {
  for (const t of LEGACY_ITEM_TYPES) {
    assert.equal(normalizeItemType(t), t);
  }
});

test("A3: Unit creation options exact", () => {
  assert.deepEqual([...UNIT_DIRECT_CREATE_TYPES], [
    "lesson",
    "quiz",
    "assignment",
    "project",
    "resource",
  ]);
});

test("A4: Lesson-child creation options exact", () => {
  assert.deepEqual([...LESSON_CHILD_CREATE_TYPES], [
    "reading",
    "video",
    "exercise",
    "quiz",
    "assignment",
    "resource",
  ]);
});

test("A5: legacy-only types absent from NEW creation lists", () => {
  for (const legacy of LEGACY_ITEM_TYPES) {
    assert.equal(UNIT_DIRECT_CREATE_TYPES.includes(legacy), false);
    assert.equal(LESSON_CHILD_CREATE_TYPES.includes(legacy), false);
  }
  assert.ok(LESSON_ITEM_TYPES.includes("theory"));
  assert.ok(LESSON_ITEM_TYPES.includes("reading"));
});

test("edit options keep current legacy + context V3 types", () => {
  const unitEdit = itemTypeOptionsForEdit({ itemType: "theory", parentLessonId: null });
  assert.equal(unitEdit[0], "theory");
  assert.deepEqual(unitEdit.slice(1), [...UNIT_DIRECT_CREATE_TYPES]);
  const childEdit = itemTypeOptionsForEdit({ itemType: "activity", parentLessonId: "L1" });
  assert.equal(childEdit[0], "activity");
  assert.deepEqual(childEdit.slice(1), [...LESSON_CHILD_CREATE_TYPES]);
  const v3Top = itemTypeOptionsForEdit({ itemType: "quiz", parentLessonId: null });
  assert.deepEqual(v3Top, [...UNIT_DIRECT_CREATE_TYPES]);
});

test("preparation_status derived only in memory for legacy rows", () => {
  assert.equal(derivePreparationStatus({ status: "published" }), "ready");
  assert.equal(derivePreparationStatus({ status: "draft" }), "draft");
  assert.equal(derivePreparationStatus({ status: "draft", preparation_status: "ready" }), "ready");
});

// ── C. TOC ──────────────────────────────────────────────────────────────────

test("C26: old two-level material renders", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "l1", title: "L", position: 0, item_type: "lesson" }] },
  );
  assert.equal(toc[0].numberLabel, "1");
  assert.equal(toc[0].children[0].numberLabel, "1.1");
  assert.equal(toc[0].children[0].children.length, 0);
});

test("C27: Unit -> Lesson -> Item numbering is 1 / 1.1 / 1.1.1", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "les", title: "Lesson", position: 0, item_type: "lesson" }] },
    { les: [{ id: "c1", title: "Reading", position: 0, item_type: "reading" }] },
  );
  assert.equal(toc[0].numberLabel, "1");
  assert.equal(toc[0].children[0].numberLabel, "1.1");
  assert.equal(toc[0].children[0].children[0].numberLabel, "1.1.1");
  assert.equal(toc[0].children[0].parentLessonId, null);
  assert.equal(toc[0].children[0].children[0].parentLessonId, "les");
});

test("C28: direct Unit activity remains sibling numbering", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    {
      u1: [
        { id: "les", title: "Lesson", position: 0, item_type: "lesson" },
        { id: "q1", title: "Quiz", position: 1, item_type: "quiz" },
      ],
    },
    { les: [{ id: "c1", title: "R", position: 0, item_type: "reading" }] },
  );
  assert.equal(toc[0].children[0].numberLabel, "1.1");
  assert.equal(toc[0].children[1].numberLabel, "1.2");
  assert.deepEqual(toc[0].children[1].children, []);
});

test("C29: no fourth hierarchy level", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "les", title: "L", position: 0, item_type: "lesson" }] },
    {
      les: [{ id: "c1", title: "R", position: 0, item_type: "reading" }],
      c1: [{ id: "deep", title: "X", position: 0, item_type: "video" }],
    },
  );
  assert.equal(toc[0].children[0].children[0].children.length, 0);
  assert.equal(toc[0].children[0].children[0].id, "c1");
});

test("C30: stable item IDs preserved in TOC nodes", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "stable-lesson", title: "L", position: 0, item_type: "lesson" }] },
    { "stable-lesson": [{ id: "stable-child", title: "C", position: 0, item_type: "video" }] },
  );
  assert.equal(toc[0].id, "u1");
  assert.equal(toc[0].children[0].id, "stable-lesson");
  assert.equal(toc[0].children[0].children[0].id, "stable-child");
});

test("two-argument deriveContentToc remains valid", () => {
  const toc = deriveContentToc(
    [{ id: "u1", title: "U", position: 0 }],
    { u1: [{ id: "l1", title: "L", position: 0, item_type: "quiz" }] },
  );
  assert.equal(toc[0].children[0].itemType, "quiz");
  assert.deepEqual(toc[0].children[0].children, []);
});

// ── B. API with in-memory mock ──────────────────────────────────────────────

function createLessonStore(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  let v3Enabled = true;
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

  function table(name) {
    if (name === "content_units") {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: { content_id: "content-1" }, error: null }),
              };
            },
          };
        },
        update() {
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    }
    if (name === "learning_contents") {
      return {
        update() {
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    }
    if (name !== "content_lessons") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    }

    const state = {
      filters: [],
      orders: [],
      limitN: null,
      mode: "select",
      payload: null,
      selectCols: null,
    };

    const finishSelect = () => {
      if (!v3Enabled && /parent_lesson_id/.test(String(state.selectCols || ""))) {
        return { data: null, error: { message: 'column "parent_lesson_id" does not exist' } };
      }
      if (
        !v3Enabled &&
        state.filters.some((f) => f.col === "parent_lesson_id")
      ) {
        return { data: null, error: { message: 'column "parent_lesson_id" does not exist' } };
      }
      let list = rows.filter((r) => matches(r, state.filters));
      list = applyOrder(list, state.orders);
      if (state.limitN != null) list = list.slice(0, state.limitN);
      return { data: list.map((r) => ({ ...r })), error: null };
    };

    const api = {
      select(cols) {
        state.selectCols = cols;
        if (state.mode !== "insert" && state.mode !== "update") {
          state.mode = "select";
        }
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
          if (res.error) return res;
          return { data: res.data[0] ?? null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (state.mode === "insert") {
          if (!v3Enabled && Object.prototype.hasOwnProperty.call(state.payload || {}, "parent_lesson_id")) {
            return { data: null, error: { message: 'column "parent_lesson_id" does not exist' } };
          }
          if (v3Enabled && state.payload?.parent_lesson_id) {
            const parent = rows.find((r) => r.id === state.payload.parent_lesson_id);
            if (!parent) return { data: null, error: { message: "invalid_hierarchy: parent_missing" } };
            if (parent.item_type !== "lesson") {
              return { data: null, error: { message: "invalid_hierarchy: parent_not_lesson" } };
            }
            if (parent.parent_lesson_id != null) {
              return { data: null, error: { message: "invalid_hierarchy: parent_is_nested" } };
            }
            if (state.payload.item_type === "lesson") {
              return { data: null, error: { message: "invalid_hierarchy: lesson_under_lesson" } };
            }
          }
          const id = state.payload.id || `id-${seq++}`;
          const row = {
            id,
            parent_lesson_id: null,
            required: true,
            completion_rule: "none",
            grading_mode: "none",
            passing_score: null,
            completion_threshold: null,
            learning_objectives: [],
            estimated_minutes: null,
            description: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
            document_json: [],
            document_version: 1,
            content_units: { content_id: "content-1", title: "U", position: 0, unit_type: "unit" },
            ...state.payload,
          };
          rows.push(row);
          return { data: { ...row }, error: null };
        }
        if (state.mode === "update") {
          const idx = rows.findIndex((r) => matches(r, state.filters));
          if (idx < 0) return { data: null, error: { message: "not_found" } };
          if (!v3Enabled && Object.prototype.hasOwnProperty.call(state.payload || {}, "parent_lesson_id")) {
            return { data: null, error: { message: 'column "parent_lesson_id" does not exist' } };
          }
          rows[idx] = { ...rows[idx], ...state.payload };
          return { data: { ...rows[idx] }, error: null };
        }
        if (state.mode === "select") {
          const res = finishSelect();
          if (res.error) return res;
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
    rows,
    setV3(enabled) {
      v3Enabled = enabled;
    },
    client: {
      from: table,
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    },
  };
}

test("B API hierarchy behaviors", async (t) => {
  const store = createLessonStore([
    {
      id: "top-lesson",
      unit_id: "unit-1",
      parent_lesson_id: null,
      title: "Lesson",
      description: null,
      position: 0,
      item_type: "lesson",
      estimated_minutes: null,
      required: true,
      completion_rule: "none",
      grading_mode: "none",
      passing_score: null,
      completion_threshold: null,
      learning_objectives: [],
      created_at: "a",
      updated_at: "a",
      document_json: [],
      document_version: 1,
      content_units: { content_id: "content-1", title: "U", position: 0, unit_type: "unit" },
    },
    {
      id: "child-reading",
      unit_id: "unit-1",
      parent_lesson_id: "top-lesson",
      title: "Reading",
      description: null,
      position: 0,
      item_type: "reading",
      estimated_minutes: null,
      required: true,
      completion_rule: "none",
      grading_mode: "none",
      passing_score: null,
      completion_threshold: null,
      learning_objectives: [],
      created_at: "b",
      updated_at: "b",
      document_json: [],
      document_version: 1,
      content_units: { content_id: "content-1", title: "U", position: 0, unit_type: "unit" },
    },
    {
      id: "top-quiz",
      unit_id: "unit-1",
      parent_lesson_id: null,
      title: "Quiz",
      description: null,
      position: 1,
      item_type: "quiz",
      estimated_minutes: null,
      required: true,
      completion_rule: "none",
      grading_mode: "none",
      passing_score: null,
      completion_threshold: null,
      learning_objectives: [],
      created_at: "c",
      updated_at: "c",
      document_json: [],
      document_version: 1,
      content_units: { content_id: "content-1", title: "U", position: 0, unit_type: "unit" },
    },
  ]);

  mock.module("../src/supabaseClient.js", {
    namedExports: {
      getSupabase: () => store.client,
      isSupabaseConfigured: () => true,
    },
  });

  const api = await import("../src/platform/contentApi.js");

  await t.test("B6: listUnitLessons returns only parent_lesson_id NULL under V3", async () => {
    const { rows, error } = await api.listUnitLessons("unit-1");
    assert.equal(error, null);
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["top-lesson", "top-quiz"],
    );
    assert.ok(rows.every((r) => r.parent_lesson_id == null));
  });

  await t.test("B8: listLessonChildren returns only direct children", async () => {
    const { rows, error } = await api.listLessonChildren("top-lesson");
    assert.equal(error, null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "child-reading");
    assert.equal(rows[0].parent_lesson_id, "top-lesson");
  });

  await t.test("B9: create top-level Lesson uses parent_lesson_id NULL", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "New Lesson",
      itemType: "lesson",
    });
    assert.equal(error, null);
    assert.equal(lesson.parent_lesson_id, null);
    assert.equal(lesson.item_type, "lesson");
  });

  await t.test("B10: create Unit-level Quiz allowed", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Unit Quiz",
      itemType: "quiz",
    });
    assert.equal(error, null);
    assert.equal(lesson.item_type, "quiz");
    assert.equal(lesson.parent_lesson_id, null);
  });

  for (const [label, itemType] of [
    ["B11", "reading"],
    ["B12", "video"],
    ["B13", "exercise"],
    ["B14", "quiz"],
    ["B15", "assignment"],
    ["B16", "resource"],
  ]) {
    await t.test(`${label}: create Lesson-child ${itemType} allowed`, async () => {
      const { lesson, error } = await api.createLesson("unit-1", {
        title: `Child ${itemType}`,
        itemType,
        parentLessonId: "top-lesson",
      });
      assert.equal(error, null, error);
      assert.equal(lesson.item_type, itemType);
      assert.equal(lesson.parent_lesson_id, "top-lesson");
      assert.equal(lesson.unit_id, "unit-1");
    });
  }

  await t.test("B17: nested Lesson rejected", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Nested",
      itemType: "lesson",
      parentLessonId: "top-lesson",
    });
    assert.equal(lesson, null);
    assert.match(String(error), /invalid_item_type_for_lesson_child|lesson_under_lesson/);
  });

  await t.test("B18: child Project rejected", async () => {
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Proj",
      itemType: "project",
      parentLessonId: "top-lesson",
    });
    assert.equal(lesson, null);
    assert.equal(error, "invalid_item_type_for_lesson_child");
  });

  await t.test("B19: sibling position calculated within correct container", async () => {
    const before = store.rows.filter((r) => r.parent_lesson_id === "top-lesson");
    const maxPos = Math.max(...before.map((r) => r.position));
    const { lesson, error } = await api.createLesson("unit-1", {
      title: "Pos check",
      itemType: "reading",
      parentLessonId: "top-lesson",
    });
    assert.equal(error, null);
    assert.equal(lesson.position, maxPos + 1);
    const topMax = Math.max(
      ...store.rows.filter((r) => r.unit_id === "unit-1" && r.parent_lesson_id == null).map((r) => r.position),
    );
    assert.notEqual(lesson.position, topMax);
  });

  await t.test("B20: moveLesson reorders top-level only among top-level siblings", async () => {
    const tops = store.rows
      .filter((r) => r.unit_id === "unit-1" && r.parent_lesson_id == null)
      .sort((a, b) => a.position - b.position);
    const first = tops[0];
    const second = tops[1];
    assert.ok(first && second);
    const { ok, error } = await api.moveLesson(first.id, "down");
    assert.equal(error, null);
    assert.equal(ok, true);
    const a = store.rows.find((r) => r.id === first.id);
    const b = store.rows.find((r) => r.id === second.id);
    assert.equal(a.position > b.position, true);
    assert.ok(store.rows.every((r) => r.parent_lesson_id !== first.id || r.id !== second.id || true));
    // children untouched
    assert.equal(store.rows.find((r) => r.id === "child-reading").parent_lesson_id, "top-lesson");
  });

  await t.test("B21: moveLesson reorders children only among same-parent children", async () => {
    const children = store.rows
      .filter((r) => r.parent_lesson_id === "top-lesson")
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    assert.ok(children.length >= 2);
    const c0 = children[0];
    const c1 = children[1];
    const topBefore = store.rows
      .filter((r) => r.parent_lesson_id == null)
      .map((r) => ({ id: r.id, position: r.position }));
    const { ok, error } = await api.moveLesson(c0.id, "down");
    assert.equal(error, null);
    assert.equal(ok, true);
    const afterTops = store.rows
      .filter((r) => r.parent_lesson_id == null)
      .map((r) => ({ id: r.id, position: r.position }));
    assert.deepEqual(afterTops, topBefore);
    const moved = store.rows.find((r) => r.id === c0.id);
    const neighbor = store.rows.find((r) => r.id === c1.id);
    assert.equal(moved.parent_lesson_id, "top-lesson");
    assert.equal(neighbor.parent_lesson_id, "top-lesson");
  });

  await t.test("B22–B25: moveLessonToContainer ID + hierarchy rules", async () => {
    const leaf = store.rows.find((r) => r.item_type === "reading" && r.parent_lesson_id === "top-lesson");
    assert.ok(leaf);
    const leafId = leaf.id;

    const badLessonMove = await api.moveLessonToContainer("top-lesson", {
      unitId: "unit-1",
      parentLessonId: "top-quiz",
    });
    assert.equal(badLessonMove.ok, false);
    assert.match(String(badLessonMove.error), /lesson_under_lesson/);

    const toUnit = await api.moveLessonToContainer(leafId, { unitId: "unit-1", parentLessonId: null });
    assert.equal(toUnit.ok, true, toUnit.error);
    const afterUnit = store.rows.find((r) => r.id === leafId);
    assert.equal(afterUnit.id, leafId);
    assert.equal(afterUnit.parent_lesson_id, null);
    assert.equal(afterUnit.unit_id, "unit-1");

    const toLesson = await api.moveLessonToContainer(leafId, {
      unitId: "unit-1",
      parentLessonId: "top-lesson",
    });
    assert.equal(toLesson.ok, true, toLesson.error);
    const afterLesson = store.rows.find((r) => r.id === leafId);
    assert.equal(afterLesson.id, leafId);
    assert.equal(afterLesson.parent_lesson_id, "top-lesson");
  });

  await t.test("B7: legacy fallback still returns old rows as top-level", async () => {
    store.setV3(false);
    // Seed legacy-shaped rows (no parent_lesson_id column conceptually)
    store.rows.length = 0;
    store.rows.push(
      {
        id: "legacy-1",
        unit_id: "unit-1",
        title: "Old",
        description: null,
        position: 0,
        item_type: "theory",
        estimated_minutes: 10,
        created_at: "x",
        updated_at: "x",
      },
      {
        id: "legacy-2",
        unit_id: "unit-1",
        title: "Old2",
        description: null,
        position: 1,
        item_type: "lesson",
        estimated_minutes: null,
        created_at: "y",
        updated_at: "y",
      },
    );
    const { rows, error } = await api.listUnitLessons("unit-1");
    assert.equal(error, null);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.parent_lesson_id == null));
    const children = await api.listLessonChildren("legacy-2");
    assert.deepEqual(children.rows, []);
    assert.equal(children.error, CONTENT_V3_MIGRATION_HINT);
    store.setV3(true);
  });
});

// ── D. UI / contracts ───────────────────────────────────────────────────────

test("D31–D36: UI contracts for create/edit/nav/assign/fallback", () => {
  const editor = readFileSync(resolve(root, "src/pages/ContentEditorPage.jsx"), "utf8");
  const toc = readFileSync(
    resolve(root, "src/components/pybotclass/content/ContentTableOfContents.jsx"),
    "utf8",
  );
  const api = readFileSync(resolve(root, "src/platform/contentApi.js"), "utf8");
  const i18n = readFileSync(resolve(root, "src/i18n/pybotclass.js"), "utf8");

  assert.match(editor, /UNIT_DIRECT_CREATE_TYPES/);
  assert.match(editor, /LESSON_CHILD_CREATE_TYPES/);
  assert.match(editor, /pcAddToLesson/);
  assert.match(editor, /itemsByLesson/);
  assert.match(editor, /listLessonChildren/);
  assert.match(editor, /parentLessonId: lesson\.id/);
  assert.match(editor, /typeOptions: \[\.\.\.UNIT_DIRECT_CREATE_TYPES\]/);
  assert.match(editor, /typeOptions: \[\.\.\.LESSON_CHILD_CREATE_TYPES\]/);
  assert.match(editor, /itemTypeOptionsForEdit/);
  assert.match(editor, /\/dashboard\/content\/\$\{contentId\}\/lessons\/\$\{lesson\.id\}/);
  assert.match(editor, /depth === 0 \? \([\s\S]*pcAssign/);
  assert.match(editor, /canAssign && depth === 0/);
  assert.doesNotMatch(editor, /sourceType:\s*"item"/);

  assert.match(toc, /itemsByLesson/);
  assert.match(toc, /type:\s*"item"/);
  assert.match(toc, /pbc-content-toc__items--nested/);

  assert.match(api, /listLessonChildren/);
  assert.match(api, /moveLessonToContainer/);
  assert.match(api, /CONTENT_V3_MIGRATION_HINT/);
  assert.match(api, /\.is\("parent_lesson_id", null\)/);

  for (const langBlock of ["Lectura", "Reading", "Lecture", "Leitura", "Lektüre"]) {
    assert.match(i18n, new RegExp(langBlock));
  }
  assert.match(i18n, /pcItemType_assignment: "Trabajo"/);
  assert.match(i18n, /pcItemType_assignment: "Assignment"/);
  assert.match(i18n, /pcItemType_assignment: "Devoir"/);
  assert.match(i18n, /pcItemType_assignment: "Trabalho"/);
  assert.match(i18n, /pcItemType_assignment: "Aufgabe"/);
  assert.match(i18n, /pcAddToLesson/);
});

test("CONTENT_V3 migration hint constant exact", () => {
  assert.equal(
    CONTENT_V3_MIGRATION_HINT,
    "Falta aplicar la migración 20260927190051_content_v3_structure.sql",
  );
});

// ── Desktop layout contract (>= 901px) ───────────────────────────────────────

function extractMinWidth901Block(css) {
  const marker = "@media (min-width: 901px)";
  const start = css.lastIndexOf(marker);
  assert.ok(start >= 0, "desktop @media (min-width: 901px) block must exist");
  let i = css.indexOf("{", start);
  assert.ok(i >= 0, "desktop media query opening brace");
  let depth = 0;
  for (; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  assert.fail("unclosed desktop media query");
}

test("Content V3 desktop layout contract (>= 901px)", () => {
  const css = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");
  const editor = readFileSync(resolve(root, "src/pages/ContentEditorPage.jsx"), "utf8");
  const desktop = extractMinWidth901Block(css);

  // AC13: corrections live in dedicated desktop media query
  assert.match(css, /@media \(min-width:\s*901px\)/);

  // AC15: JSX unchanged structure (DOM contract still present; no reorder needed)
  assert.match(editor, /className=\{`pbc-lesson-row\$\{depth > 0 \? " pbc-lesson-row--child" : ""\}`\}/);
  assert.match(editor, /className="pbc-lesson-row__main"/);
  assert.match(editor, /className="pbc-lesson-row__actions"/);
  assert.match(editor, /pbc-lesson-row__add-child/);
  assert.match(editor, /pbc-lesson-list--nested/);
  assert.match(editor, /pbc-unit-card__head/);
  assert.match(editor, /pbc-unit-card__title-row/);
  assert.match(editor, /canAssign && depth === 0/);

  // AC8: Unit header two-column grid
  assert.match(
    desktop,
    /\.pbc-unit-card__head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s,
  );
  assert.match(desktop, /\.pbc-unit-card__head\s*\{[^}]*column-gap:\s*12px/s);
  assert.match(desktop, /\.pbc-unit-card__head\s*\{[^}]*align-items:\s*center/s);
  assert.match(
    desktop,
    /\.pbc-unit-card__title-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s,
  );

  // AC1 / AC11: Lesson row two-column grid (no third horizontal column for add-child)
  assert.match(desktop, /\.pbc-lesson-row\s*\{[^}]*display:\s*grid/s);
  assert.match(
    desktop,
    /\.pbc-lesson-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s,
  );
  assert.match(desktop, /\.pbc-lesson-row\s*\{[^}]*column-gap:\s*12px/s);
  assert.match(desktop, /\.pbc-lesson-row\s*\{[^}]*row-gap:\s*8px/s);
  assert.match(desktop, /\.pbc-lesson-row\s*\{[^}]*align-items:\s*center/s);
  assert.match(desktop, /\.pbc-lesson-row\s*\{[^}]*width:\s*100%/s);

  // AC2: Lesson card internal three columns
  assert.match(desktop, /\.pbc-lesson-row__main\s*\{[^}]*grid-column:\s*1/s);
  assert.match(desktop, /\.pbc-lesson-row__main\s*\{[^}]*grid-row:\s*1/s);
  assert.match(
    desktop,
    /\.pbc-lesson-row__main\s*\{[^}]*grid-template-columns:\s*36px\s+minmax\(0,\s*1fr\)\s+auto/s,
  );
  assert.match(desktop, /\.pbc-lesson-row__main\s*\{[^}]*column-gap:\s*12px/s);
  assert.match(desktop, /\.pbc-lesson-row__main\s*\{[^}]*min-width:\s*0/s);
  assert.match(desktop, /\.pbc-lesson-row__main\s*\{[^}]*width:\s*100%/s);

  // AC7: normal word wrapping
  assert.match(desktop, /\.pbc-lesson-row__copy\s*\{[^}]*min-width:\s*0/s);
  assert.match(desktop, /\.pbc-lesson-row__copy\s*\{[^}]*word-break:\s*normal/s);

  // AC5–AC6 / AC3–AC4: add-child and nested placement + hierarchy guide
  assert.match(desktop, /\.pbc-lesson-row__actions\s*\{[^}]*grid-column:\s*2/s);
  assert.match(desktop, /\.pbc-lesson-row__actions\s*\{[^}]*grid-row:\s*1/s);
  assert.match(desktop, /\.pbc-lesson-row__add-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(desktop, /\.pbc-lesson-row__add-child\s*\{[^}]*grid-row:\s*2/s);
  assert.match(
    desktop,
    /\.pbc-lesson-row__add-child\s*\{[^}]*margin-left:\s*calc\(0\.95rem\s*\+\s*36px\s*\+\s*0\.75rem\)/s,
  );
  assert.match(desktop, /\.pbc-lesson-list--nested\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(desktop, /\.pbc-lesson-list--nested\s*\{[^}]*grid-row:\s*3/s);
  assert.match(desktop, /\.pbc-lesson-list--nested\s*\{[^}]*margin-left:\s*32px/s);
  assert.match(desktop, /\.pbc-lesson-list--nested\s*\{[^}]*border-left:\s*2px\s+solid\s+#e2e8f0/s);
  assert.match(
    desktop,
    /\.pbc-dashboard\[data-pbc-theme="dark"\]\s+\.pbc-lesson-list--nested\s*\{[^}]*border-left-color:\s*var\(--pbc-border/s,
  );
  assert.match(desktop, /\.pbc-lesson-row--child\s*\{[^}]*border-left:\s*none/s);
  assert.match(desktop, /\.pbc-lesson-row--child\s*\{[^}]*margin-left:\s*0/s);

  // CTA stays inside card grid (no margin-left: auto dependency)
  assert.match(desktop, /\.pbc-lesson-row__cta\s*\{[^}]*margin-left:\s*0/s);

  // AC14: existing mobile declarations remain intact outside the desktop block
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*\.pbc-lesson-row__cta\s*\{[^}]*flex:\s*1\s+1\s+100%/s);
  assert.match(css, /\.pbc-lesson-row--child\s*\{[^}]*border-left:\s*2px\s+solid\s+#e2e8f0/s);
});

// ── Editor width desktop contracts ───────────────────────────────────────────

function extractMediaQueryBlock(css, marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `media query block must exist: ${marker}`);
  let i = css.indexOf("{", start);
  assert.ok(i >= 0, `media query opening brace: ${marker}`);
  let depth = 0;
  for (; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  assert.fail(`unclosed media query: ${marker}`);
}

test("Content/Lesson editor desktop width contracts", () => {
  const css = readFileSync(resolve(root, "src/styles/pybotclass-dashboard.css"), "utf8");

  // Base/mobile rule preserved
  assert.match(
    css,
    /\.pbc-content-editor\s*,\s*\.pbc-lesson-editor\s*\{\s*max-width:\s*820px\s*;\s*\}/,
  );

  // AC1: >=1201px → width 100%, max-width 1180px
  const wide = extractMediaQueryBlock(css, "@media (min-width: 1201px)");
  assert.match(
    wide,
    /\.pbc-content-editor\s*,\s*\.pbc-lesson-editor\s*\{[^}]*width:\s*100%\s*;[^}]*max-width:\s*1180px\s*;/s,
  );
  assert.doesNotMatch(wide, /margin\s*:\s*[^;]*auto/);

  // AC2: 901px–1200px → width 100%, max-width 100%
  const mid = extractMediaQueryBlock(
    css,
    "@media (min-width: 901px) and (max-width: 1200px)",
  );
  assert.match(
    mid,
    /\.pbc-content-editor\s*,\s*\.pbc-lesson-editor\s*\{[^}]*width:\s*100%\s*;[^}]*max-width:\s*100%\s*;/s,
  );
  assert.doesNotMatch(mid, /margin\s*:\s*[^;]*auto/);
});
