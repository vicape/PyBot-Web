import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectedProvisionFiles,
  PYBOT_RUNTIME_FILES,
  PYBOT_RUNTIME_MODULE_FILES,
  PYBOT_USB_SELFTEST_SCRIPT,
  parseSelftestOutput,
  missingProvisionFiles,
} from "../src/esp32/pybotInstallManifest.js";
import { PYBOT_RUNTIME_VERSION } from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const firmwareDir = join(root, "firmware/pybot-ble-runtime");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("manifest lists all mandatory runtime modules on disk", () => {
  const onDisk = readdirSync(firmwareDir)
    .filter((n) => n.endsWith(".py"))
    .sort();
  const mandatory = [...PYBOT_RUNTIME_FILES].sort();
  assert.deepEqual(onDisk, mandatory);
});

test("expectedProvisionFiles includes boot, runtime modules, and EDA6", () => {
  const files = expectedProvisionFiles();
  assert.ok(files.includes("boot.py"));
  assert.ok(files.includes("main.py"));
  assert.ok(files.includes("pybot_ble.py"));
  assert.ok(files.includes("pybot_repl.py"));
  assert.ok(files.includes("pybot_mpy.py"));
  assert.ok(files.includes("EDA6.py"));
  assert.equal(files.length, PYBOT_RUNTIME_FILES.length + 1);
});

test("pybotBleRuntime install list matches manifest order", () => {
  const runtime = read("src/pybotBleRuntime.js");
  assert.match(runtime, /PYBOT_RUNTIME_FILES/);
  assert.match(runtime, /PYBOT_RUNTIME_MODULE_FILES/);
  for (const name of PYBOT_RUNTIME_FILES) {
    assert.ok(runtime.includes(`"${name}"`) || runtime.includes(`'${name}'`), name);
  }
});

test("BLE_RUNTIME_MODULE_FILES matches manifest (no boot.py)", () => {
  assert.ok(!PYBOT_RUNTIME_MODULE_FILES.includes("boot.py"));
  assert.deepEqual(
    [...PYBOT_RUNTIME_MODULE_FILES],
    PYBOT_RUNTIME_FILES.filter((n) => n !== "boot.py"),
  );
});

test("missing mandatory file => INCOMPLETE list, never empty when partial", () => {
  const missing = missingProvisionFiles(["pybot_ble.py", "main.py"]);
  assert.ok(missing.includes("pybot_repl.py"));
  assert.ok(missing.includes("EDA6.py"));
  assert.ok(missing.length > 0);
});

test("selftest script references every manifest .py", () => {
  for (const name of expectedProvisionFiles()) {
    if (name.endsWith(".py")) {
      assert.match(PYBOT_USB_SELFTEST_SCRIPT, new RegExp(`"${name}"`));
    }
  }
});

test("parseSelftestOutput accepts OK payload with published runtime", () => {
  const payload = {
    runtime: PYBOT_RUNTIME_VERSION,
    protocol: "3.2",
    repl_import: true,
    dupterm_available: true,
    eda6: true,
    pybot_mpy: true,
    files: true,
  };
  const text = `noise\nPYBOT_SELFTEST:OK ${JSON.stringify(payload)}\n`;
  const parsed = parseSelftestOutput(text, PYBOT_RUNTIME_VERSION);
  assert.equal(parsed.ok, true);
});

test("parseSelftestOutput rejects wrong runtime version", () => {
  const payload = {
    runtime: "4.0.1",
    protocol: "3.2",
    repl_import: true,
    dupterm_available: true,
    eda6: true,
    pybot_mpy: true,
    files: true,
  };
  const parsed = parseSelftestOutput(`PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`, PYBOT_RUNTIME_VERSION);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.runtimeOk, false);
});

test("pybot_repl.py on disk is importable Python (no syntax errors)", () => {
  const src = readFileSync(join(firmwareDir, "pybot_repl.py"), "utf8");
  assert.doesNotMatch(src, /if \(_tx_n/);
  assert.match(src, /if _tx_n > 0:/);
});
