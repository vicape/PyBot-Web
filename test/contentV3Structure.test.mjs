import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// EXECUTION ENVIRONMENT: CLOUD via MaxCloud only
// BASELINE: ba552fd501b1916af52d14f90b2213338056e740
// URL: /dashboard/content/:contentId/lessons/:lessonId
// Schema literals: public.content_lessons(id); parent_lesson_id = id;
// unit_id NOT NULL; child.unit_id; child.item_type;
// required boolean NOT NULL DEFAULT true;
// completion_rule text NOT NULL DEFAULT 'none';
// grading_mode text NOT NULL DEFAULT 'none';
// learning_objectives text[] NOT NULL DEFAULT '{}';
// preparation_status text NOT NULL DEFAULT 'draft'; preparation_status = 'ready';
// learning_contents.status; activities.content_snapshot; activities.content_source_id;
// activities.activity_kind; content|unit|lesson|exercise|task; material|exercise|task
// PRESERVE: current Content UI; BlockNote editor; viewer; Library UI; Community;
// copy provenance; current assignment flows; current activity flows; current submissions;
// current progress; Google Classroom; authentication; courses; IDE; ESP32; EDA6;
// hardware; telemetry; mobile typography; desktop typography.

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260927190051_content_v3_structure.sql",
);
const migration = readFileSync(migrationPath, "utf8");

const baseSchema = readFileSync(
  resolve(root, "supabase/migrations/20260831000035_learning_contents.sql"),
  "utf8",
);
const materialV2 = readFileSync(
  resolve(root, "supabase/migrations/20260924100048_material_v2_ownership_copy_metadata.sql"),
  "utf8",
);
const snapshotMig = readFileSync(
  resolve(root, "supabase/migrations/20260903000040_content_snapshot_assignments.sql"),
  "utf8",
);
const sharingMig = readFileSync(
  resolve(root, "supabase/migrations/20260903000039_content_sharing.sql"),
  "utf8",
);

test("(1) existing content schema remains valid — additive only, physical hierarchy preserved", () => {
  assert.ok(existsSync(migrationPath));
  assert.match(baseSchema, /create table if not exists public\.learning_contents/);
  assert.match(baseSchema, /create table if not exists public\.content_units/);
  assert.match(baseSchema, /create table if not exists public\.content_lessons/);
  assert.doesNotMatch(migration, /drop table public\.learning_contents/i);
  assert.doesNotMatch(migration, /drop table public\.content_units/i);
  assert.doesNotMatch(migration, /drop table public\.content_lessons/i);
  assert.doesNotMatch(migration, /create table\s+public\.content_nodes/i);
  assert.doesNotMatch(migration, /rename\s+to\s+content_nodes/i);
  assert.match(migration, /Content V3 learning items/);
  assert.match(migration, /backward-compatible physical name|backward compatibility/i);
});

test("(2) existing lessons backfill as top-level rows (parent_lesson_id NULL)", () => {
  assert.match(migration, /add column if not exists parent_lesson_id uuid/);
  assert.match(migration, /parent_lesson_id = NULL|parent_lesson_id IS NULL|leaves every existing row with parent_lesson_id = NULL/i);
  assert.match(
    migration,
    /NULL = item directly under a Unit/i,
  );
  // Must not force-null nested rows on re-apply
  assert.doesNotMatch(
    migration,
    /update\s+public\.content_lessons\s+set\s+parent_lesson_id\s*=\s*null\s+where\s+true/i,
  );
});

test("(3–7) lesson may contain Reading/Video/Exercise/Quiz/Assignment", () => {
  for (const t of ["reading", "video", "exercise", "quiz", "assignment"]) {
    assert.match(migration, new RegExp(`'${t}'`));
  }
  assert.match(migration, /invalid_hierarchy: lesson_under_lesson/);
  assert.match(migration, /parent\.item_type is distinct from 'lesson'|v_parent\.item_type is distinct from 'lesson'/);
  assert.match(migration, /if new\.item_type = 'lesson'/);
  // Child non-lesson under lesson allowed when parent is lesson and parent is top-level
  assert.match(migration, /content_lessons_validate_hierarchy/);
});

test("(8–9) Unit may directly contain Quiz/Assignment", () => {
  assert.match(migration, /if new\.parent_lesson_id is null then\s+return new;/s);
  assert.match(migration, /'quiz'/);
  assert.match(migration, /'assignment'/);
});

test("(10) lesson -> lesson rejected", () => {
  assert.match(migration, /invalid_hierarchy: lesson_under_lesson/);
});

test("(11) item -> child rejected", () => {
  assert.match(migration, /invalid_hierarchy: parent_not_lesson/);
  assert.match(migration, /invalid_hierarchy: parent_is_nested/);
});

test("(12) child and parent with different unit_id rejected", () => {
  assert.match(migration, /invalid_hierarchy: unit_mismatch/);
  assert.match(migration, /new\.unit_id is distinct from v_parent\.unit_id/);
});

test("(13) self-parent rejected", () => {
  assert.match(migration, /content_lessons_parent_not_self_check/);
  assert.match(migration, /parent_lesson_id is distinct from id/);
  assert.match(migration, /invalid_hierarchy: self_parent/);
});

test("(14) moving top-level Lesson between Units propagates unit_id to children", () => {
  assert.match(migration, /content_lessons_propagate_unit_id/);
  assert.match(migration, /new\.parent_lesson_id is null/);
  assert.match(migration, /new\.unit_id is distinct from old\.unit_id/);
  assert.match(migration, /where parent_lesson_id = new\.id/);
  assert.match(migration, /set unit_id = new\.unit_id/);
});

test("(15) IDs remain unchanged during move", () => {
  assert.match(
    migration,
    /without changing child IDs or parent_lesson_id/,
  );
  const propagateFn = migration.match(
    /create or replace function public\.content_lessons_propagate_unit_id\(\)[\s\S]*?^\$\$;/m,
  );
  assert.ok(propagateFn, "propagate function present");
  assert.match(propagateFn[0], /update public\.content_lessons/);
  assert.match(
    propagateFn[0],
    /set unit_id = new\.unit_id,\s*updated_at = now\(\)/,
  );
  assert.match(propagateFn[0], /where parent_lesson_id = new\.id/);
  assert.doesNotMatch(propagateFn[0], /insert into/i);
  assert.doesNotMatch(propagateFn[0], /gen_random_uuid/i);
});

test("(16) deleting Lesson cascades to child items", () => {
  assert.match(migration, /content_lessons_parent_lesson_id_fkey/);
  assert.match(migration, /on delete cascade/i);
  assert.match(
    migration,
    /references public\.content_lessons\(id\)\s+on delete cascade/i,
  );
  assert.match(migration, /public\.content_lessons\(id\)/);
  assert.match(migration, /parent_lesson_id = id/);
});

test("(17) copy_learning_content creates independent item IDs", () => {
  assert.match(migration, /create or replace function public\.copy_learning_content/);
  assert.match(migration, /v_id_map jsonb/);
  assert.match(migration, /jsonb_build_object\(v_lesson\.id::text, v_new_lesson_id::text\)/);
  assert.match(migration, /returning id into v_new_lesson_id/);
});

test("(18) copied children point to copied parent", () => {
  assert.match(migration, /parent_lesson_id is not null/);
  assert.match(
    migration,
    /v_new_parent_id := \(v_id_map ->> v_lesson\.parent_lesson_id::text\)::uuid/,
  );
  assert.match(migration, /v_new_parent_id,/);
  assert.match(migration, /copy_failed: missing_parent_map/);
  assert.match(migration, /maps to copied parent|NEW parent/i);
});

test("(19) original provenance still preserved", () => {
  assert.match(migration, /copied_from_content_id/);
  assert.match(migration, /original_content_id/);
  assert.match(migration, /original_owner_id/);
  assert.match(migration, /original_creator_id/);
  assert.match(migration, /first_community_published_by_id/);
  assert.match(migration, /first_community_published_at/);
  assert.match(migration, /v_src\.id,/);
  assert.match(migration, /v_root_id,/);
  assert.match(migration, /Provenance content-level only/);
});

test("(20) preparation_status backfill is correct", () => {
  assert.match(migration, /add column if not exists preparation_status/);
  assert.match(migration, /preparation_status text NOT NULL DEFAULT 'draft'/);
  assert.match(migration, /preparation_status text NOT NULL DEFAULT/);
  assert.match(migration, /learning_contents\.status/);
  assert.match(migration, /preparation_status = 'ready'/);
  assert.match(migration, /learning_contents_preparation_status_check/);
  assert.match(migration, /preparation_status in \('draft', 'ready'\)/);
  assert.match(
    migration,
    /when status = 'published' then 'ready'/,
  );
  assert.match(migration, /else 'draft'/);
});

test("(21) existing visibility remains unchanged", () => {
  assert.match(sharingMig, /visibility in \('private', 'courses', 'community'\)/);
  assert.doesNotMatch(migration, /learning_contents_visibility_check/);
  assert.doesNotMatch(migration, /drop column.*visibility/i);
  assert.match(migration, /Independent of visibility/);
  assert.match(migration, /status column unchanged|Do NOT remove or change existing status|status unchanged/i);
});

test("(22) existing assignment snapshots remain untouched", () => {
  assert.match(snapshotMig, /content_snapshot/);
  assert.match(migration, /activities\.content_snapshot/);
  assert.match(migration, /activities\.content_source_id/);
  assert.doesNotMatch(migration, /alter table public\.activities[\s\S]*content_snapshot/i);
  assert.doesNotMatch(migration, /update\s+public\.activities[\s\S]*content_snapshot/i);
  assert.doesNotMatch(migration, /drop column.*content_snapshot/i);
});

test("(23) existing content_source_type values remain accepted", () => {
  assert.match(migration, /'content'/);
  assert.match(migration, /'unit'/);
  assert.match(migration, /'lesson'/);
  assert.match(migration, /'exercise'/);
  assert.match(migration, /'task'/);
  assert.match(migration, /content\|unit\|lesson\|exercise\|task/);
  assert.match(migration, /activities_content_source_type_check/);
});

test("(24) new content_source_type 'item' is accepted", () => {
  assert.match(
    migration,
    /content_source_type in \([\s\S]*'item'/,
  );
});

test("(25) invalid completion_rule rejected", () => {
  assert.match(migration, /content_lessons_completion_rule_check/);
  assert.match(
    migration,
    /completion_rule in \(\s*'none',\s*'marked_complete',\s*'viewed',\s*'video_threshold',\s*'submitted',\s*'quiz_finished'\s*\)/s,
  );
});

test("(26) invalid grading_mode rejected", () => {
  assert.match(migration, /content_lessons_grading_mode_check/);
  assert.match(migration, /grading_mode in \('none', 'automatic', 'teacher'\)/);
});

test("(27) passing_score outside 0–100 rejected", () => {
  assert.match(migration, /content_lessons_passing_score_check/);
  assert.match(
    migration,
    /passing_score is null or \(passing_score >= 0 and passing_score <= 100\)/,
  );
});

test("(28) completion_threshold outside 0–1 rejected", () => {
  assert.match(migration, /content_lessons_completion_threshold_check/);
  assert.match(
    migration,
    /completion_threshold is null\s+or \(completion_threshold >= 0 and completion_threshold <= 1\)/s,
  );
});

test("copy RPC copies required configuration fields and hierarchy", () => {
  assert.match(migration, /required,/);
  assert.match(migration, /completion_rule,/);
  assert.match(migration, /completion_threshold,/);
  assert.match(migration, /grading_mode,/);
  assert.match(migration, /passing_score,/);
  assert.match(migration, /learning_objectives/);
  assert.match(migration, /parent_lesson_id is null/);
  assert.match(migration, /document_json/);
  assert.match(migration, /document_version/);
  assert.match(migration, /item_type/);
  assert.match(migration, /estimated_minutes/);
  assert.match(migration, /lesson_blocks/);
});

test("indexes for ordering without UNIQUE on position", () => {
  assert.match(migration, /content_lessons_parent_position_idx/);
  assert.match(migration, /\(parent_lesson_id, position\)/);
  assert.match(migration, /content_lessons_unit_parent_position_idx/);
  assert.match(migration, /\(unit_id, parent_lesson_id, position\)/);
  assert.doesNotMatch(
    migration,
    /unique\s*\(.*position/i,
  );
  assert.doesNotMatch(migration, /content_lessons_.*position.*unique/i);
});

test("legacy item_type values preserved; reading/video/assignment added", () => {
  for (const t of [
    "lesson",
    "theory",
    "example",
    "activity",
    "exercise",
    "quiz",
    "test",
    "project",
    "resource",
    "reading",
    "video",
    "assignment",
  ]) {
    assert.match(migration, new RegExp(`'${t}'`));
  }
  assert.match(migration, /content_lessons_item_type_check/);
  assert.match(materialV2, /'theory'/);
});

test("FK parent_lesson_id ON DELETE CASCADE; required/completion defaults", () => {
  assert.match(migration, /required boolean NOT NULL DEFAULT true/);
  assert.match(migration, /completion_rule text NOT NULL DEFAULT 'none'/);
  assert.match(migration, /grading_mode text NOT NULL DEFAULT 'none'/);
  assert.match(migration, /learning_objectives text\[] NOT NULL DEFAULT '\{\}'/);
  assert.match(migration, /unit_id NOT NULL/);
  assert.match(migration, /child\.unit_id/);
  assert.match(migration, /child\.item_type/);
  assert.match(migration, /on delete cascade/i);
});

test("RLS not weakened; can_read helpers not replaced insecurely", () => {
  assert.doesNotMatch(migration, /drop policy/i);
  assert.doesNotMatch(migration, /create or replace function public\.can_read_learning_content/);
  assert.doesNotMatch(migration, /create or replace function public\.can_read_content_unit/);
  assert.doesNotMatch(migration, /create or replace function public\.can_read_content_lesson/);
  assert.doesNotMatch(migration, /enable row level security/i);
});

test("activity_kind and status columns not redesigned", () => {
  assert.match(migration, /activities\.activity_kind/);
  assert.match(migration, /material\|exercise\|task/);
  assert.match(migration, /\/dashboard\/content\/:contentId\/lessons\/:lessonId/);
  assert.match(migration, /CLOUD via MaxCloud only/);
  assert.match(migration, /ba552fd501b1916af52d14f90b2213338056e740/);
  assert.doesNotMatch(migration, /drop constraint if exists learning_contents_status_check/);
  assert.doesNotMatch(migration, /drop column.*\bstatus\b/i);
});
