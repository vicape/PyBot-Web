/**
 * Point 5 — engagement persistence contracts: idempotence, pending queue, auth boundaries.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ENGAGEMENT_PENDING_STORAGE_KEY,
  discardLegacyUnscopedPendingEngagement,
  normalizePendingSegment,
  pendingEngagementStorageKeyForUser,
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
const hardeningPath = resolve(
  root,
  "supabase/migrations/20261001014500_activity_engagement_segment_hardening.sql",
);

const USER_A = "user-a";
const USER_B = "user-b";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
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
    USER_A,
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
    USER_A,
  );
  let rows = readPendingEngagementSegments(storage, USER_A);
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
    USER_A,
  );
  rows = readPendingEngagementSegments(storage, USER_A);
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
    USER_A,
  );
  rows = readPendingEngagementSegments(storage, USER_A);
  assert.equal(rows[0].activeMs, 2500);
});

test("AC20/AC21: write-ahead before RPC; failed sync keeps pending; ack clears", async () => {
  const storage = memoryStorage();
  const calls = [];
  let sawPendingBeforeRpc = false;
  const supabaseFail = {
    rpc: async (name, args) => {
      // Write-ahead must already have persisted before RPC runs
      sawPendingBeforeRpc =
        readPendingEngagementSegments(storage, USER_A).length === 1 &&
        readPendingEngagementSegments(storage, USER_A)[0].activeMs === 800;
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
    USER_A,
  );
  assert.equal(r1.ok, false);
  assert.equal(r1.queued, true);
  assert.equal(sawPendingBeforeRpc, true);
  assert.equal(readPendingEngagementSegments(storage, USER_A).length, 1);
  assert.equal(readPendingEngagementSegments(storage, USER_A)[0].activeMs, 800);

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

  const pending = readPendingEngagementSegments(storage, USER_A)[0];
  const r2 = await upsertActivityEngagementSegment(pending, supabaseOk, storage, USER_A);
  assert.equal(r2.ok, true);
  assert.equal(readPendingEngagementSegments(storage, USER_A).length, 0);
});

test("local queue separation between user A and user B", () => {
  const storage = memoryStorage();
  queuePendingEngagementSegment(
    {
      clientSegmentId: "sa",
      activityId: "a1",
      targetId: "t1",
      activeMs: 100,
      clientStartedAt: 1,
      ended: false,
    },
    storage,
    USER_A,
  );
  queuePendingEngagementSegment(
    {
      clientSegmentId: "sb",
      activityId: "a1",
      targetId: "t2",
      activeMs: 200,
      clientStartedAt: 1,
      ended: false,
    },
    storage,
    USER_B,
  );
  const a = readPendingEngagementSegments(storage, USER_A);
  const b = readPendingEngagementSegments(storage, USER_B);
  assert.equal(a.length, 1);
  assert.equal(a[0].clientSegmentId, "sa");
  assert.equal(b.length, 1);
  assert.equal(b[0].clientSegmentId, "sb");
  assert.ok(pendingEngagementStorageKeyForUser(USER_A).endsWith(USER_A));
  assert.ok(pendingEngagementStorageKeyForUser(USER_A).includes("pending.v2."));
  assert.notEqual(
    pendingEngagementStorageKeyForUser(USER_A),
    pendingEngagementStorageKeyForUser(USER_B),
  );
});

test("legacy v1 unscoped queue never reassigns; discarded safely", () => {
  const storage = memoryStorage({
    [ENGAGEMENT_PENDING_STORAGE_KEY]: JSON.stringify([
      {
        clientSegmentId: "legacy",
        activityId: "a1",
        targetId: "t1",
        activeMs: 999,
        clientStartedAt: 1,
        ended: false,
      },
    ]),
  });
  // Reading as a newly logged-in user must not claim v1 rows
  const rows = readPendingEngagementSegments(storage, USER_A);
  assert.equal(rows.length, 0);
  assert.equal(storage.getItem(ENGAGEMENT_PENDING_STORAGE_KEY), null);

  // Explicit discard is also safe when key already gone
  discardLegacyUnscopedPendingEngagement(storage);
  assert.equal(storage.getItem(ENGAGEMENT_PENDING_STORAGE_KEY), null);
});

test("stale ACK cannot clear newer pending absolute total", async () => {
  const storage = memoryStorage();
  let resolveRpc;
  const rpcPromise = new Promise((resolve) => {
    resolveRpc = resolve;
  });

  const supabaseSlow = {
    rpc: async () => {
      const data = await rpcPromise;
      return { data, error: null };
    },
  };

  const sendOlder = upsertActivityEngagementSegment(
    {
      clientSegmentId: "race",
      activityId: "a1",
      targetId: "t1",
      activeMs: 1000,
      clientStartedAt: 1_000_000,
      ended: false,
    },
    supabaseSlow,
    storage,
    USER_A,
  );

  // Newer local absolute total arrives while older RPC is in flight
  queuePendingEngagementSegment(
    {
      clientSegmentId: "race",
      activityId: "a1",
      targetId: "t1",
      activeMs: 2500,
      clientStartedAt: 1_000_000,
      ended: false,
    },
    storage,
    USER_A,
  );
  assert.equal(readPendingEngagementSegments(storage, USER_A)[0].activeMs, 2500);

  resolveRpc({ ok: true, row: { client_segment_id: "race", active_ms: 1000 } });
  const r = await sendOlder;
  assert.equal(r.ok, true);
  // Stale ACK (1000) must not erase newer pending (2500)
  const pending = readPendingEngagementSegments(storage, USER_A);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].activeMs, 2500);

  // ACK >= pending clears
  removePendingEngagementSegment("race", storage, USER_A, { onlyIfAckMsAtLeast: 2500 });
  assert.equal(readPendingEngagementSegments(storage, USER_A).length, 0);
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

test("hardening migration: immutable identity, stored-start plausibility, ended cannot grow, monotonic", () => {
  const sql = readFileSync(hardeningPath, "utf8");
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /identity_mismatch/);
  assert.match(sql, /for update/i);
  assert.match(sql, /v_existing\.client_started_at/);
  assert.match(sql, /v_existing\.ended/);
  assert.match(sql, /ended=true/);
  assert.match(sql, /90,000/);
  assert.match(sql, /greatest\(v_existing\.active_ms, v_active\)/i);
  assert.match(sql, /can_write_activity_engagement/);
  // Must not broaden RLS or touch Point 4
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /activity_item_progress/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate/i);
  // Historical migration file must remain the original path (not edited by this repair)
  const historical = readFileSync(migrationPath, "utf8");
  assert.match(historical, /target_id = trim\(p_target_id\)/);
  // No test-file lifecycle change — existing suites stay registered in test/suiteManifest.mjs
  assert.equal(existsSync(resolve(root, "test/suiteManifest.mjs")), true);
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
  // localUserId is namespace only — never RPC write identity
  assert.match(sync, /localUserId/);
  assert.match(sync, /pending\.v2/);
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
  const hard = readFileSync(hardeningPath, "utf8");
  assert.doesNotMatch(hard, /alter table public\.activity_item_progress/);
});
