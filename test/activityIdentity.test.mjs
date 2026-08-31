import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readSrc(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

test("el flujo de actividades no busca por título en la base", () => {
  const files = [
    "src/platform/activityIdeSession.js",
    "src/platform/activityProgress.js",
    "src/platform/courseActivityApi.js",
    "src/pages/ActivityPage.jsx",
  ];

  for (const file of files) {
    const src = readSrc(file);
    assert.match(src, /\.eq\("id", activityId\)|\.eq\('id', activityId\)|p_activity_id|activity_id/, file);
    assert.doesNotMatch(src, /\.eq\(["']title["']/);
    assert.doesNotMatch(src, /\.ilike\(/);
  }
});

test("sessionStorage de lanzamiento discrimina por activityId", async () => {
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };

  const { writeActivityLaunchCache, readActivityLaunchCache } = await import(
    "../src/platform/courseActivityApi.js"
  );

  writeActivityLaunchCache("uuid-a", "codigo A");
  assert.equal(readActivityLaunchCache("uuid-a"), "codigo A");
  assert.equal(readActivityLaunchCache("uuid-b"), null);

  writeActivityLaunchCache("uuid-b", "codigo B");
  assert.equal(readActivityLaunchCache("uuid-a"), null);
  assert.equal(readActivityLaunchCache("uuid-b"), "codigo B");
});
