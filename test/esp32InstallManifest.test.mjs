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
  PYBOT_REQUIRED_MICROPYTHON,
  PYBOT_REQUIRED_PROTOCOL,
  parseSelftestOutput,
  missingProvisionFiles,
  isCompatibleMicroPython,
} from "../src/esp32/pybotInstallManifest.js";
import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION } from "../src/bleProtocol.js";

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

function okSelftestPayload(overrides = {}) {
  const files = expectedProvisionFiles().filter((n) => n.endsWith(".py"));
  const hashes = {};
  const sizes = {};
  for (const n of files) {
    hashes[n] = "ab".repeat(32);
    sizes[n] = 64;
  }
  return {
    runtime: PYBOT_RUNTIME_VERSION,
    protocol: PYBOT_PROTOCOL_VERSION,
    repl_import: true,
    dupterm_available: true,
    eda6: true,
    pybot_mpy: true,
    files: true,
    boot: true,
    main: true,
    hashes,
    sizes,
    ...overrides,
  };
}

test("manifest is the unique source of truth for bundle + versions", () => {
  assert.equal(PYBOT_REQUIRED_MICROPYTHON, "1.27.0");
  assert.equal(PYBOT_REQUIRED_PROTOCOL, "3.2");
  const files = expectedProvisionFiles();
  assert.deepEqual(
    files,
    [
      "boot.py",
      "main.py",
      "pybot_ble.py",
      "pybot_run.py",
      "pybot_deploy.py",
      "pybot_update.py",
      "pybot_boot_update.py",
      "pybot_repl.py",
      "pybot_net.py",
      "pybot_mpy.py",
      "EDA6.py",
    ],
  );
});

test("missing mandatory file => INCOMPLETE list, never empty when partial", () => {
  const missing = missingProvisionFiles(["pybot_ble.py", "main.py"]);
  assert.ok(missing.includes("pybot_repl.py"));
  assert.ok(missing.includes("EDA6.py"));
  assert.ok(missing.length > 0);
});

test("missing EDA6 or pybot_repl is never READY", () => {
  const noEda6 = expectedProvisionFiles().filter((n) => n !== "EDA6.py");
  assert.ok(missingProvisionFiles(noEda6).includes("EDA6.py"));
  const noRepl = expectedProvisionFiles().filter((n) => n !== "pybot_repl.py");
  assert.ok(missingProvisionFiles(noRepl).includes("pybot_repl.py"));
});

test("selftest script references every manifest .py", () => {
  for (const name of expectedProvisionFiles()) {
    if (name.endsWith(".py")) {
      assert.match(PYBOT_USB_SELFTEST_SCRIPT, new RegExp(`"${name}"`));
    }
  }
});

test("parseSelftestOutput accepts OK payload with published runtime", () => {
  const text = `noise\nPYBOT_SELFTEST:OK ${JSON.stringify(okSelftestPayload())}\n`;
  const parsed = parseSelftestOutput(text, PYBOT_RUNTIME_VERSION);
  assert.equal(parsed.ok, true);
});

test("parseSelftestOutput rejects wrong runtime version", () => {
  const payload = okSelftestPayload({ runtime: "4.0.1" });
  const parsed = parseSelftestOutput(`PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`, PYBOT_RUNTIME_VERSION);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.runtimeOk, false);
});

test("failed self-test (missing hashes or EDA6) is not OK", () => {
  const noEda6 = okSelftestPayload({ eda6: false });
  assert.equal(parseSelftestOutput(`PYBOT_SELFTEST:OK ${JSON.stringify(noEda6)}`).ok, false);
  const noHashes = okSelftestPayload({ hashes: {} });
  assert.equal(parseSelftestOutput(`PYBOT_SELFTEST:OK ${JSON.stringify(noHashes)}`).ok, false);
  assert.equal(parseSelftestOutput("PYBOT_SELFTEST:FAIL boom").ok, false);
});

test("compatible MicroPython 1.27.0 is kept; other versions are not", () => {
  assert.equal(isCompatibleMicroPython("1.27.0"), true);
  assert.equal(isCompatibleMicroPython("1.22.0"), false);
  assert.equal(isCompatibleMicroPython(null), true);
});

test("pybot_repl.py on disk is importable Python (no syntax errors)", () => {
  const src = readFileSync(join(firmwareDir, "pybot_repl.py"), "utf8");
  assert.doesNotMatch(src, /if \(_tx_n/);
  assert.match(src, /while _tx_n > 0:/);
});
