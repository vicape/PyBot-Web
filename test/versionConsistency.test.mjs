import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readJson(name) {
  return JSON.parse(readFileSync(resolve(root, name), "utf8"));
}

test("package and lockfile expose the same root version", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");

  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.[""]?.version, pkg.version);
});
