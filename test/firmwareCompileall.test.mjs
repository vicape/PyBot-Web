import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const firmwareDir = join(root, "firmware/pybot-ble-runtime");

test("compileall: all firmware .py files have valid Python syntax", () => {
  let out;
  try {
    out = execSync(`python -m compileall -q "${firmwareDir}"`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const stderr = String(e.stderr ?? e.stdout ?? e.message);
    assert.fail(`firmware compileall failed:\n${stderr}`);
  }
  assert.equal(out ?? "", "");
});
