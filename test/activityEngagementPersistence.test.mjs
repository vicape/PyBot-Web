/**
 * Point 5 — engagement persistence contracts: idempotence, pending queue, auth boundaries.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ENGAGEMENT_PENDING_STORAGE_KEY,
  normalizePendingSegment,
  prunePendingEngagementSegments,
  queuePendingEngagementSegment,
  readPendingEngagementSegments,
  removePendingEngagementSegment,
  upsertActivityEngagementSegment,
  writePendingEngagementSegments,
} from "../src/platform/activityEngagementSync.js";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260930233000_activity_engagement_segments.sql",
);

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("AC18/AC19: pending queue keeps absolute monotonic total per segment", () => {
  const storage = memoryStorage();
  queuePendingEngagementSegment(
    {
      clientSegmentId: "s1",
      activityId: "a1",
      targetId: "t1",
      targetType: "material",
      activeMs: 1000,
      clientStartedAt: 1_000_000,
      ended: false,
    },
    storage,
  );
  queuePendingEngagementSegment(
    {
      clientSegmentId: "s1",
      activityId: "a1",
      targetId: "t1",
      targetType: "material",
      activeMs: 1000,
      clientStartedAt: 1_000_000,
      ended: false,
    },
    storage,
  );
  let rows = readPendingEngagementSegments(storage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].activeMs, 1000);

  queuePendingEngagementSegment(
    {
      clientSegmentId: "s1",
      activityId: "a1",
      targetId: "t1",
      activeMs: 2500,
      clientStartedAt: 1_000_000,
      ended: true,
    },
    storage,
  );
  rows = readPendingEngagementSegments(storage);
  assert.equal(rows[0].activeMs, 2500);
  assert.equal(rows[0].ended, true);

  // Decreasing absolute must not shrink pending
  queuePendingEngagementSegment(
    {
      clientSegmentId: "s1",
      activityId: "a1",
      targetId: "t1",
      activeMs: 500,
      clientStartedAt: 1_000_000,
      ended: true,
    },
    storage,
  );
  rows = readPendingEngagementSegments(storage);
  assert.equal(rows[0].activeMs, 2500);
});

test("AC20/AC21: failed sync queues pending; ack clears; retry does not invent open-page time", async () => {
  const storage = memoryStorage();
  const calls = [];
  const supabaseFail = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: null, error: { message: "network" } };
    },
  };

  const r1 = await upsertActivityEngagementSegment(
    {
      clientSegmentId: "s2",
      activityId: "a1",
      targetId: "t1",
      activeMs: 800,
      clientStartedAt: Date.now() - 800,
      ended: true,
    },
    supabaseFail,
    storage,
  );
  assert.equal(r1.ok, false);
  assert.equal(r1.queued, true);
  assert.equal(readPendingEngagementSegments(storage).length, 1);
  assert.equal(readPendingEngagementSegments(storage)[0].activeMs, 800);

  const supabaseOk = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      assert.equal(name, "upsert_activity_engagement_segment");
      assert.equal(args.p_active_ms, 800);
      assert.equal(args.p_client_segment_id, "s2");
      // Absolute total — never "plus N"
      assert.equal(Object.prototype.hasOwnProperty.call(args, "p_delta_ms"), false);
      return {
        data: { ok: true, row: { client_segment_id: "s2", active_ms: 800 } },
        error: null,
      };
    },
  };

  const pending = readPendingEngagementSegments(storage)[0];
  const r2 = await upsertActivityEngagementSegment(pending, supabaseOk, storage);
  assert.equal(r2.ok, true);
  assert.equal(readPendingEngagementSegments(storage).length, 0);
});

test("AC26: pending normalization drops unknown event payload fields", () => {
  const row = normalizePendingSegment({
    clientSegmentId: "s",
    activityId: "a",
    targetId: "t",
    activeMs: 10,
    clientStartedAt: 100,
    keyPressed: "a",
    typedText: "hello",
    pointerX: 12,
    scrollTop: 99,
    events: [{ type: "keydown" }],
  });
  assert.equal(row.clientSegmentId, "s");
  assert.equal(row.activeMs, 10);
  assert.equal(row.keyPressed, undefined);
  assert.equal(row.typedText, undefined);
  assert.equal(row.pointerX, undefined);
  assert.equal(row.scrollTop, undefined);
  assert.equal(row.events, undefined);
});

test("stale pending rows prune safely", () => {
  const now = Date.now();
  const rows = prunePendingEngagementSegments(
    [
      {
        clientSegmentId: "old",
        activityId: "a",
        targetId: "t",
        activeMs: 1,
        clientStartedAt: 1,
        updatedAt: now - 8 * 24 * 60 * 60 * 1000,
      },
      {
        clientSegmentId: "new",
        activityId: "a",
        targetId: "t",
        activeMs: 2,
        clientStartedAt: 1,
        updatedAt: now,
      },
    ],
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clientSegmentId, "new");
});

test("RPC migration enforces self-only write, teacher read-without-write, duration clamp", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /can_write_activity_engagement/);
  assert.match(sql, /cm\.role = 'student'/);
  assert.match(sql, /is_course_teacher/);
  assert.match(sql, /invalid_active_ms/);
  assert.match(sql, /invalid_client_started_at/);
  assert.match(sql, /v_max_plausible/);
  assert.match(sql, /least\(p_active_ms, v_max_plausible\)/);
  assert.match(sql, /if v_active < v_existing\.active_ms/);
  // Teachers can read via can_read; no teacher write policy / grant path for mutating others
  assert.match(sql, /can_read_activity_engagement/);
  assert.doesNotMatch(sql, /for insert to authenticated[\s\S]*is_course_teacher/);
  assert.doesNotMatch(sql, /preferred_role/);
  // No raw interaction columns
  assert.doesNotMatch(sql, /keystroke|key_code|pointer_x|scroll_pos|event_log|typed_text/i);
});

test("AC22-AC25 contract: write requires student membership; cross-student read denied in RPC", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /Students may only read their own rows even if they pass another user id/,
  );
  assert.match(sql, /v_target is distinct from v_uid/);
  assert.match(sql, /user_id = v_uid/);
});

test("upsert client never trusts client user id field", () => {
  const sync = readFileSync(resolve(root, "src/platform/activityEngagementSync.js"), "utf8");
  assert.match(sync, /upsert_activity_engagement_segment/);
  const upsertBlock = sync.match(
    /export async function upsertActivityEngagementSegment[\s\S]*?^export async function fetchActivityEngagementSegments/m,
  );
  assert.ok(upsertBlock, "upsert function block");
  assert.doesNotMatch(upsertBlock[0], /p_user_id/);
  assert.match(sync, /ENGAGEMENT_PENDING_STORAGE_KEY/);
  assert.equal(typeof writePendingEngagementSegments, "function");
  assert.ok(ENGAGEMENT_PENDING_STORAGE_KEY.includes("engagement"));
});

test("Point 4 progress storage unchanged by engagement migration", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.doesNotMatch(sql, /alter table public\.activity_item_progress/);
  assert.doesNotMatch(sql, /upsert_activity_item_progress/);
  const progressMig = readFileSync(
    resolve(root, "supabase/migrations/20260930200054_activity_item_progress.sql"),
    "utf8",
  );
  assert.match(progressMig, /No grades\/scores\/rubric\/active_ms/);
});
