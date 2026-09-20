import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_SUITES, filesForSuite } from "./suiteManifest.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));

test("every *.test.mjs file belongs to exactly one suite", () => {
  const actual = readdirSync(testDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();

  const classified = filesForSuite("full").sort();

  assert.deepEqual(classified, actual);

  const duplicates = Object.values(TEST_SUITES)
    .flat()
    .filter((name, index, all) => all.indexOf(name) !== index);

  assert.deepEqual(duplicates, []);
});

test("suite names remain explicit and stable", () => {
  assert.deepEqual(Object.keys(TEST_SUITES).sort(), [
    "architecture",
    "contracts",
    "fast",
  ]);
});
