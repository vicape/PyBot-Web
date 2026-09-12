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
import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION, sha256HexUtf8 } from "../src/bleProtocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const firmwareDir = join(root, "firmware/pybot-ble-runtime");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** Mismo contenido que Vite `?raw` / getBleRuntimeInstallFiles (sin importar módulos Vite). */
function getBleRuntimeInstallFilesFromDisk() {
  return PYBOT_RUNTIME_FILES.map((name) => ({
    name,
    source: readFileSync(join(firmwareDir, name), "utf8"),
  }));
}

/** Misma transformación que getEda6LibrarySource(profile). */
function getEda6LibrarySourceFromDisk(profile = "WEMOS") {
  const placa = profile === "ESP32" ? "ESP32" : "WEMOS";
  const raw = read("src/assets/EDA6.py");
  return raw.replace(/PLACA_ACTUAL\s*=\s*"[^"]*"/, `PLACA_ACTUAL = "${placa}"`);
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
    rble_import: true,
    rble_version: 1,
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
      "pybot_rble.py",
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

test("selftest verifies files by streaming hash, not full read/compile", () => {
  assert.doesNotMatch(PYBOT_USB_SELFTEST_SCRIPT, /raw\s*=\s*f\.read\(\)/);
  assert.doesNotMatch(PYBOT_USB_SELFTEST_SCRIPT, /raw\.decode\(\)/);
  assert.doesNotMatch(PYBOT_USB_SELFTEST_SCRIPT, /compile\(/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /f\.read\(256\)/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /os\.stat\(fn\)\[6\]/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /h\.update\(chunk\)/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /import pybot_ble/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /import pybot_repl/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /import pybot_rble/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /import EDA6/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /import pybot_mpy/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /"hashes"/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /"sizes"/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /r\['boot'\]/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /r\['main'\]/);
  assert.match(PYBOT_USB_SELFTEST_SCRIPT, /r\["files"\]/);
  assert.doesNotMatch(PYBOT_USB_SELFTEST_SCRIPT, /pybot_ble\.main\(/);
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

function buildExpectedFromSources(profile = "WEMOS") {
  const expectedHashes = {};
  for (const { name, source } of getBleRuntimeInstallFilesFromDisk()) {
    expectedHashes[name] = sha256HexUtf8(String(source ?? ""));
  }
  expectedHashes["EDA6.py"] = sha256HexUtf8(getEda6LibrarySourceFromDisk(profile));
  return expectedHashes;
}

function payloadMatchingExpected(expectedHashes, overrides = {}) {
  const files = expectedProvisionFiles().filter((n) => n.endsWith(".py"));
  const hashes = {};
  const sizes = {};
  for (const n of files) {
    hashes[n] = expectedHashes[n];
    sizes[n] = 64;
  }
  return okSelftestPayload({ hashes, sizes, ...overrides });
}

test("CASO1: all expected hashes match → hashesOk true", () => {
  const expectedHashes = buildExpectedFromSources("WEMOS");
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payloadMatchingExpected(expectedHashes))}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, true);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.hashMismatches, []);
});

test("CASO2/regression: non-empty wrong hash fails (bug punto 10)", () => {
  const expectedHashes = buildExpectedFromSources("WEMOS");
  const payload = payloadMatchingExpected(expectedHashes);
  // Antes: cualquier string no vacío pasaba. Ahora debe fallar.
  payload.hashes["pybot_rble.py"] = "bb".repeat(32);
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, false);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, "hash_mismatch");
  assert.ok(parsed.hashMismatches.some((m) => m.name === "pybot_rble.py"));
});

test("CASO3: empty actual hash fails", () => {
  const expectedHashes = buildExpectedFromSources();
  const payload = payloadMatchingExpected(expectedHashes);
  payload.hashes["boot.py"] = "";
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, false);
  assert.equal(parsed.ok, false);
});

test("CASO4: invalid actual hash fails", () => {
  const expectedHashes = buildExpectedFromSources();
  const payload = payloadMatchingExpected(expectedHashes);
  payload.hashes["main.py"] = "xyz";
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, false);
});

test("CASO5: missing expected hash entry fails", () => {
  const expectedHashes = buildExpectedFromSources();
  const incomplete = { ...expectedHashes };
  delete incomplete["pybot_ble.py"];
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payloadMatchingExpected(expectedHashes))}`,
    PYBOT_RUNTIME_VERSION,
    incomplete,
  );
  assert.equal(parsed.hashesOk, false);
  assert.ok(parsed.hashMismatches.some((m) => m.name === "pybot_ble.py"));
});

test("CASO6: invalid expected hash fails", () => {
  const expectedHashes = buildExpectedFromSources();
  const bad = { ...expectedHashes, "boot.py": "not-a-hash" };
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payloadMatchingExpected(expectedHashes))}`,
    PYBOT_RUNTIME_VERSION,
    bad,
  );
  assert.equal(parsed.hashesOk, false);
});

test("CASO7: case-normalized hashes match", () => {
  const expectedHashes = buildExpectedFromSources();
  const payload = payloadMatchingExpected(expectedHashes);
  for (const name of Object.keys(payload.hashes)) {
    payload.hashes[name] = payload.hashes[name].toUpperCase();
  }
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, true);
  assert.equal(parsed.ok, true);
});

test("CASO8: one-byte source change changes sha and is detected", () => {
  const a = "print(1)\n";
  const b = "print(2)\n";
  const ha = sha256HexUtf8(a);
  const hb = sha256HexUtf8(b);
  assert.notEqual(ha, hb);
  const expectedHashes = buildExpectedFromSources();
  expectedHashes["pybot_mpy.py"] = ha;
  const payload = payloadMatchingExpected(expectedHashes);
  payload.hashes["pybot_mpy.py"] = hb;
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.hashesOk, false);
  assert.ok(parsed.hashMismatches.some((m) => m.name === "pybot_mpy.py"));
});

test("CASO9: UTF-8 multibyte uses sha256HexUtf8 bytes", () => {
  const src = "áéñ — ESP32";
  const h = sha256HexUtf8(src);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h.length, src.length);
});

test("CASO10: EDA6 WEMOS vs ESP32 expected hashes differ when sources differ", () => {
  const w = sha256HexUtf8(getEda6LibrarySourceFromDisk("WEMOS"));
  const e = sha256HexUtf8(getEda6LibrarySourceFromDisk("ESP32"));
  assert.notEqual(w, e);
  const expW = buildExpectedFromSources("WEMOS");
  const expE = buildExpectedFromSources("ESP32");
  assert.notEqual(expW["EDA6.py"], expE["EDA6.py"]);
});

test("CASO11: current runtime with old file content fails by hash", () => {
  const expectedHashes = buildExpectedFromSources();
  const payload = payloadMatchingExpected(expectedHashes, {
    runtime: PYBOT_RUNTIME_VERSION,
    protocol: "3.2",
  });
  payload.hashes["pybot_ble.py"] = "11".repeat(32);
  const parsed = parseSelftestOutput(
    `PYBOT_SELFTEST:OK ${JSON.stringify(payload)}`,
    PYBOT_RUNTIME_VERSION,
    expectedHashes,
  );
  assert.equal(parsed.runtimeOk, true);
  assert.equal(parsed.protocolOk, true);
  assert.equal(parsed.hashesOk, false);
  assert.equal(parsed.ok, false);
});

test("CASO12: hardwareBridge verifyPybotFiles passes expectedHashes", () => {
  const bridge = read("src/hardwareBridge.js");
  assert.match(bridge, /buildProvisionExpectedHashes/);
  assert.match(bridge, /getBleRuntimeInstallFiles\(\)/);
  assert.match(bridge, /getEda6LibrarySource\(profile\)/);
  assert.match(bridge, /sha256HexUtf8/);
  assert.match(
    bridge,
    /parseSelftestOutput\(\s*stdout,\s*PYBOT_RUNTIME_VERSION,\s*buildProvisionExpectedHashes/,
  );
});

test("expected hashes cover every provision .py file", () => {
  const expectedHashes = buildExpectedFromSources("ESP32");
  for (const name of expectedProvisionFiles().filter((n) => n.endsWith(".py"))) {
    assert.match(expectedHashes[name], /^[0-9a-f]{64}$/, name);
  }
});

test("compatible MicroPython 1.27.0 is kept; other versions are not", () => {
  assert.equal(isCompatibleMicroPython("1.27.0"), true);
  assert.equal(isCompatibleMicroPython("1.22.0"), false);
  assert.equal(isCompatibleMicroPython(null), true);
});

test("pybot_repl.py on disk is importable Python (no syntax errors)", () => {
  const src = readFileSync(join(firmwareDir, "pybot_repl.py"), "utf8");
  assert.doesNotMatch(src, /if \(_tx_n/);
  assert.match(src, /while _tx_n > 0/);
});
