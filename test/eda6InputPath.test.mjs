/**
 * Regresión P0: rutas de entradas EDA6 + enrutamiento USB/BLE vs Pyodide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PIN_MAPS, detectEda6Adc2Risk } from "../src/eda6PinMaps.js";
import {
  EDA6_LIBRARY_VERSION,
  buildEda6ImportedPrelude,
  buildEda6VersionGuard,
} from "../src/eda6Ensure.js";
import { resolveEsp32ExecutionTarget } from "../src/esp32RunTarget.js";
import { EXAMPLES } from "../src/examplesData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function findPython() {
  for (const cmd of ["python", "py", "python3"]) {
    const probe = spawnSync(cmd, ["-c", "print(6*7)"], { encoding: "utf8" });
    if (probe.status === 0 && String(probe.stdout).includes("42")) return cmd;
  }
  return null;
}

test("WEMOS digital map unchanged [5,23,19,18]", () => {
  assert.deepEqual(PIN_MAPS.WEMOS.digital_inputs, [5, 23, 19, 18]);
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /"digital_inputs":\s*\[5,\s*23,\s*19,\s*18\]/);
});

test("WEMOS analog map unchanged [2,4,35,34]", () => {
  assert.deepEqual(PIN_MAPS.WEMOS.adc_inputs, [2, 4, 35, 34]);
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /"adc_inputs":\s*\[2,\s*4,\s*35,\s*34\]/);
});

test("ESP32 maps unchanged", () => {
  assert.deepEqual(PIN_MAPS.ESP32.digital_inputs, [4, 2, 15, 0]);
  assert.deepEqual(PIN_MAPS.ESP32.adc_inputs, [35, 34, 39, 36]);
});

test("EDA6 versions align at 1.1.1", () => {
  assert.equal(EDA6_LIBRARY_VERSION, "1.1.1");
  assert.match(read("src/assets/EDA6.py"), /EDA6_VERSION\s*=\s*"1\.1\.1"/);
  assert.match(read("src/eda6Ensure.js"), /EDA6_LIBRARY_VERSION\s*=\s*"1\.1\.1"/);
});

test("entradaDigital has no blind PULL_UP/PULL_DOWN", () => {
  const eda6 = read("src/assets/EDA6.py");
  const dig = eda6.slice(eda6.indexOf("def entradaDigital"), eda6.indexOf("def entradaAnalogica"));
  assert.match(dig, /machine\.Pin\(gpio,\s*machine\.Pin\.IN\)\.value\(\)/);
  assert.doesNotMatch(dig, /PULL_UP|PULL_DOWN/);
});

test("ADC2 Wi-Fi conflict and ADC lifecycle are explicit in EDA6.py", () => {
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /EDA6_ADC2_WIFI_CONFLICT/);
  assert.match(eda6, /def _ensure_adc2_usable/);
  assert.match(eda6, /def _invalidate_adc/);
  assert.match(eda6, /_ADC2_GPIOS\s*=\s*\(2,\s*4\)/);
  // ADC1 path not gated by Wi-Fi conflict for GPIO35/34
  assert.match(eda6, /if gpio not in _ADC2_GPIOS:\s*\n\s*return/);
  assert.match(eda6, /sensorDistancia[\s\S]*_invalidate_adc\(echo\)/);
  assert.match(eda6, /def detenerTodo[\s\S]*_invalidate_adc\(\)/);
  assert.match(eda6, /def _pybot_cleanup_normal[\s\S]*_invalidate_adc\(\)/);
});

test("ADC2 risk detector still separates E1/E2 from E3/E4", () => {
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(1)", "WEMOS"), true);
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(2)", "WEMOS"), true);
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(3)", "WEMOS"), false);
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(4)", "WEMOS"), false);
});

test("BLE connect clears pythonOnly; onRun uses resolveEsp32ExecutionTarget", () => {
  const ide = read("src/PyBotIDE.jsx");
  assert.match(ide, /resolveEsp32ExecutionTarget/);
  const ble = ide.slice(ide.indexOf("const onBleConnectionChange"));
  const bleBody = ble.slice(0, ble.indexOf("const onStop"));
  assert.match(bleBody, /setPythonOnly\(false\)/);
  assert.match(bleBody, /needHardwareMode/);

  const run = ide.slice(ide.indexOf("const onRun = useCallback"));
  const runBody = run.slice(0, run.indexOf("const onInstallEda6"));
  assert.match(runBody, /resolveEsp32ExecutionTarget/);
  assert.match(runBody, /switchToHardwareMode/);
  assert.match(runBody, /esp32Target\.target === "board"/);
  assert.match(runBody, /await runBoardProgram/);
  // Hardware path must not require !pythonOnly alone
  assert.doesNotMatch(
    runBody.slice(0, runBody.indexOf("resolveEsp32ExecutionTarget") + 80),
    /if \(\s*!pythonOnly &&\s*!canvasCode/,
  );
});

test("stale pythonOnly + BLE + EDA6 hardware → board, never pyodide", () => {
  const r = resolveEsp32ExecutionTarget({
    boardType: "esp32-eda6",
    pythonOnly: true,
    needsHardware: true,
    canvasCode: false,
    usbConnected: false,
    bleConnected: true,
  });
  assert.equal(r.target, "board");
  assert.equal(r.switchToHardwareMode, true);
});

test("USB + EDA6 hardware → board even with stale pythonOnly", () => {
  const r = resolveEsp32ExecutionTarget({
    boardType: "esp32-eda6",
    pythonOnly: true,
    needsHardware: true,
    usbConnected: true,
    bleConnected: false,
  });
  assert.equal(r.target, "board");
  assert.equal(r.switchToHardwareMode, true);
});

test("hardware-required EDA6 without connection → needConnect (not pyodide)", () => {
  const r = resolveEsp32ExecutionTarget({
    boardType: "esp32-eda6",
    pythonOnly: true,
    needsHardware: true,
    usbConnected: false,
    bleConnected: false,
  });
  assert.equal(r.target, "needConnect");
});

test("pure Python + pythonOnly → pyodide", () => {
  const r = resolveEsp32ExecutionTarget({
    boardType: "esp32-eda6",
    pythonOnly: true,
    needsHardware: false,
    usbConnected: false,
    bleConnected: true,
  });
  assert.equal(r.target, "pyodide");
  assert.equal(r.switchToHardwareMode, false);
});

test("pure Python + hardware mode + BLE → board", () => {
  const r = resolveEsp32ExecutionTarget({
    boardType: "esp32-micropython",
    pythonOnly: false,
    needsHardware: false,
    usbConnected: false,
    bleConnected: true,
  });
  assert.equal(r.target, "board");
});

test("USB/BLE EDA6 prelude applies WEMOS profile", () => {
  assert.match(buildEda6ImportedPrelude("WEMOS"), /EDA6\.PLACA_ACTUAL = "WEMOS"/);
  const bridge = read("src/hardwareBridge.js");
  assert.match(bridge, /buildEda6ImportedPrelude\(profile\)/);
  assert.match(bridge, /buildEda6VersionGuard/);
  assert.match(bridge, /ensureEda6OnSession/);
});

test("BLE Run guards outdated EDA6 library", () => {
  const guard = buildEda6VersionGuard();
  assert.match(guard, /EDA6_BLE_STALE_LIB/);
  assert.match(guard, new RegExp(EDA6_LIBRARY_VERSION));
  const bridge = read("src/hardwareBridge.js");
  const native = bridge.slice(bridge.indexOf("if (isNativeBleEnabled() && _bleMpSession)"));
  assert.match(native, /buildEda6VersionGuard\(\)/);
  assert.match(bridge, /userCode = buildEda6VersionGuard\(\) \+ userCode/);
});

test("diagnostic example isolates per-port errors and prints maps", () => {
  const ex = EXAMPLES.find((e) => e.id === "eda6_diagnostico_entradas");
  assert.ok(ex);
  assert.deepEqual(ex.boards, ["esp32-eda6"]);
  assert.match(ex.code, /EDA6_VERSION/);
  assert.match(ex.code, /PIN_MAPS\[PLACA_ACTUAL\]\["digital_inputs"\]/);
  assert.match(ex.code, /PIN_MAPS\[PLACA_ACTUAL\]\["adc_inputs"\]/);
  assert.match(ex.code, /entradaDigital\(n\)/);
  assert.match(ex.code, /entradaAnalogica\(n\)/);
  assert.match(ex.code, /except Exception as e:/);
});

test("i18n covers ADC2 conflict and BLE stale lib", () => {
  const i18n = read("src/i18n.js");
  assert.match(i18n, /eda6Adc2WifiConflict:/);
  assert.match(i18n, /eda6BleStaleLib:/);
  assert.match(i18n, /EDA6_ADC2_WIFI_CONFLICT/);
  assert.match(i18n, /EDA6_BLE_STALE_LIB/);
});

test("EDA6 input simulation (fake machine)", () => {
  const py = findPython();
  assert.ok(py, "python required for EDA6 input simulation");
  const sim = join(__dirname, "helpers", "eda6InputSim.py");
  const eda6 = join(root, "src", "assets", "EDA6.py");
  const r = spawnSync(py, [sim, eda6], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(String(r.stdout).trim().split("\n").pop());
  assert.equal(data.ok, true);
  assert.equal(data.version, "1.1.1");
  assert.deepEqual(data.dig, [1, 0, 1, 0]);
});
