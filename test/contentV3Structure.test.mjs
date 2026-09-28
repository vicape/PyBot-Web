/**
 * Definitive Content hierarchy — structure & migration contracts.
 * learning_contents -> content_units -> content_lessons -> content_items
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260928220052_content_items_structure.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const v3Migration = readFileSync(
  resolve(root, "supabase/migrations/20260927190051_content_v3_structure.sql"),
  "utf8",
);
const baseSchema = readFileSync(
  resolve(root, "supabase/migrations/20260831000035_learning_contents.sql"),
  "utf8",
);

test("AC1: content_items table and four-level hierarchy exist", () => {
  assert.ok(existsSync(migrationPath));
  assert.match(baseSchema, /create table if not exists public\.learning_contents/);
  assert.match(baseSchema, /create table if not exists public\.content_units/);
  assert.match(baseSchema, /create table if not exists public\.content_lessons/);
  assert.match(migration, /create table if not exists public\.content_items/);
  assert.match(migration, /lesson_id uuid not null references public\.content_lessons/);
  assert.match(migration, /on delete cascade/i);
  assert.match(migration, /learning_contents -> content_units -> content_lessons -> content_items/);
});

test("AC5: canonical item types only", () => {
  for (const t of [
    "material",
    "video",
    "example",
    "exercise",
    "quiz",
    "assignment",
    "assessment",
  ]) {
    assert.match(migration, new RegExp(`'${t}'`));
  }
  assert.match(migration, /content_items_type_check/);
  assert.doesNotMatch(
    migration.split("constraint content_items_type_check")[1].split(")")[0],
    /'reading'|'resource'|'theory'|'activity'|'test'|'project'|'lesson'/,
  );
});

test("AC6: exact legacy type mapping", () => {
  assert.match(migration, /when 'reading' then 'material'/);
  assert.match(migration, /when 'resource' then 'material'/);
  assert.match(migration, /when 'theory' then 'material'/);
  assert.match(migration, /when 'activity' then 'exercise'/);
  assert.match(migration, /when 'test' then 'assessment'/);
  assert.match(migration, /when 'project' then 'assignment'/);
  assert.match(migration, /when 'task' then 'assignment'/);
});

test("AC7–AC10: migration preserves lessons, nested items, unit items, documents", () => {
  assert.match(migration, /parent_lesson_id is not null/);
  assert.match(migration, /coalesce\(item_type, 'lesson'\) is distinct from 'lesson'/);
  assert.match(migration, /insert into public\.content_items/);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /type = 'material'/);
  assert.match(migration, /document_json/);
  assert.match(migration, /lesson_blocks/);
});

test("AC11: indexes for lesson lookup and sibling ordering", () => {
  assert.match(migration, /content_items_lesson_id_idx/);
  assert.match(migration, /content_items_lesson_position_idx/);
});

test("AC18: cascade delete via FK", () => {
  assert.match(
    migration,
    /references public\.content_lessons \(id\) on delete cascade/i,
  );
});

test("AC22/AC33: deep copy copies items with new IDs and provenance", () => {
  assert.match(migration, /create or replace function public\.copy_learning_content/);
  assert.match(migration, /insert into public\.content_items/);
  assert.match(migration, /copied_from_content_id/);
  assert.match(migration, /original_content_id/);
  assert.match(migration, /original_owner_id/);
  assert.match(migration, /original_creator_id/);
  assert.match(migration, /first_community_published_by_id/);
});

test("AC30: obsolete polymorphic columns removed after migration", () => {
  assert.match(migration, /drop column if exists parent_lesson_id/);
  assert.match(migration, /drop column if exists item_type/);
  assert.match(migration, /drop function if exists public\.content_lessons_validate_hierarchy/);
  assert.match(migration, /drop trigger if exists content_lessons_validate_hierarchy_trg/);
});

test("AC34: RLS enabled with ownership chain", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /content_items_select_own/);
  assert.match(migration, /content_items_insert_own/);
  assert.match(migration, /content_items_update_own/);
  assert.match(migration, /content_items_delete_own/);
  assert.match(migration, /content_items_select_shared/);
  assert.match(migration, /can_read_content_item/);
  assert.match(migration, /can_read_content_lesson\(i\.lesson_id\)/);
  assert.match(migration, /lc\.owner_id = auth\.uid\(\)/);
});

test("AC36: no student tracking tables introduced", () => {
  assert.doesNotMatch(migration, /create table.*student_progress/i);
  assert.doesNotMatch(migration, /create table.*attempt/i);
  assert.doesNotMatch(migration, /active_time|watch_analytics/i);
});

test("prior V3 migration remains in history (additive predecessor)", () => {
  assert.match(v3Migration, /parent_lesson_id/);
  assert.ok(existsSync(resolve(root, "supabase/migrations/20260927190051_content_v3_structure.sql")));
});
