/**
 * Regresión P0: rutas de entradas EDA6 + semántica original + sync canónico.
 * Sin versionado artificial 1.1.x.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PIN_MAPS, detectEda6Adc2Risk } from "../src/eda6PinMaps.js";
import {
  buildEda6ImportedPrelude,
  eda6NeedsInstall,
  eda6FileHash,
  eda6CanonicalHash,
  parseEda6HashProbe,
  ensureEda6OnSession,
  assertEda6CanonicalOnSession,
} from "../src/eda6Ensure.js";
import { resolveEsp32ExecutionTarget } from "../src/esp32RunTarget.js";
import { EXAMPLES } from "../src/examplesData.js";
import { buildRunnableProgram } from "../src/micropython/programWrap.js";

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
  assert.deepEqual(PIN_MAPS.ESP32.digital_outputs, [32, 25, 27, 12]);
  assert.deepEqual(PIN_MAPS.ESP32.servo_pins, [33, 26, 14, 13]);
});

test("EDA6 original has no EDA6_VERSION / no 1.1.x", () => {
  const eda6 = read("src/assets/EDA6.py");
  assert.doesNotMatch(eda6, /EDA6_VERSION/);
  assert.doesNotMatch(eda6, /1\.1\.0|1\.1\.1/);
  assert.doesNotMatch(eda6, /EDA6_ADC2_WIFI_CONFLICT|_ensure_adc2_usable|_wifi_sta_snapshot/);
  const ensure = read("src/eda6Ensure.js");
  assert.doesNotMatch(ensure, /EDA6_LIBRARY_VERSION|buildEda6VersionGuard|EDA6_BLE_STALE_LIB/);
});

test("entradaDigital uses preinit PULL_DOWN objects (original semantics)", () => {
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /Pin\(p,\s*Pin\.IN,\s*Pin\.PULL_DOWN\)/);
  assert.match(eda6, /_digital_inputs\s*=\s*\[Pin\(p,\s*Pin\.IN,\s*Pin\.PULL_DOWN\)/);
  const dig = eda6.slice(eda6.indexOf("def entradaDigital"), eda6.indexOf("def entradaAnalogica"));
  assert.match(dig, /_digital_inputs\[n_entrada\s*-\s*1\]\.value\(\)/);
  assert.doesNotMatch(dig, /PULL_UP/);
  assert.doesNotMatch(dig, /machine\.Pin\(gpio,\s*machine\.Pin\.IN\)\.value\(\)/);
});

test("entradaAnalogica uses preinit ADC, ATTN_11DB, /4050, WEMOS E1 cal", () => {
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /adc\.atten\(ADC\.ATTN_11DB\)/);
  assert.match(eda6, /_adc_inputs\.append\(adc\)/);
  assert.match(eda6, /\/ 4050\)\s*\*\s*100/);
  assert.match(eda6, /CAL_LEIDO_PIN2_RAW/);
  assert.match(eda6, /CAL_REAL_PIN2_RAW/);
  assert.match(eda6, /def _interpolar\(/);
  assert.match(eda6, /return -1/);
  assert.doesNotMatch(eda6, /_adc_cache/);
  assert.doesNotMatch(eda6, /\/ 4095/);
});

test("ADC2 risk detector still separates E1/E2 from E3/E4 (IDE, not EDA6.py)", () => {
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

test("USB/BLE EDA6 prelude applies profile via _aplicar_placa; no version guard", () => {
  assert.match(buildEda6ImportedPrelude("WEMOS"), /EDA6\._aplicar_placa\("WEMOS"\)/);
  assert.match(buildEda6ImportedPrelude("ESP32"), /EDA6\._aplicar_placa\("ESP32"\)/);
  const bridge = read("src/hardwareBridge.js");
  assert.match(bridge, /buildEda6ImportedPrelude\(profile\)/);
  assert.match(bridge, /ensureEda6OnSession/);
  assert.match(bridge, /assertEda6CanonicalOnSession/);
  assert.doesNotMatch(bridge, /buildEda6VersionGuard/);
  assert.doesNotMatch(bridge, /EDA6_BLE_STALE_LIB/);
});

test("BLE Run verifies canonical hash (no silent accept of any EDA6.py)", () => {
  const bridge = read("src/hardwareBridge.js");
  const native = bridge.slice(bridge.indexOf("if (isNativeBleEnabled() && _bleMpSession)"));
  assert.match(native, /assertEda6CanonicalOnSession/);
  assert.doesNotMatch(native, /buildEda6VersionGuard/);
  assert.doesNotMatch(bridge, /userCode = buildEda6VersionGuard/);
});

test("diagnostic example isolates per-port errors and prints maps", () => {
  const ex = EXAMPLES.find((e) => e.id === "eda6_diagnostico_entradas");
  assert.ok(ex);
  assert.deepEqual(ex.boards, ["esp32-eda6"]);
  assert.doesNotMatch(ex.code, /EDA6_VERSION/);
  assert.match(ex.code, /PIN_MAPS\[PLACA_ACTUAL\]\["digital_inputs"\]/);
  assert.match(ex.code, /PIN_MAPS\[PLACA_ACTUAL\]\["adc_inputs"\]/);
  assert.match(ex.code, /entradaDigital\(n\)/);
  assert.match(ex.code, /entradaAnalogica\(n\)/);
  assert.match(ex.code, /except Exception as e:/);
});

test("i18n keeps IDE ADC2 warning; BLE sync error uses hash not version", () => {
  const i18n = read("src/i18n.js");
  assert.match(i18n, /eda6Adc2WifiWarning:/);
  assert.match(i18n, /eda6NeedUsbSync:/);
  assert.match(i18n, /EDA6_NEED_USB_SYNC/);
  assert.doesNotMatch(i18n, /EDA6_BLE_STALE_LIB/);
  assert.doesNotMatch(i18n, /EDA6_ADC2_WIFI_CONFLICT/);
});

test("from EDA6 import * + while True covered by runnable wrap", () => {
  const prelude = buildEda6ImportedPrelude("WEMOS");
  const program = buildRunnableProgram(
    prelude,
    "from EDA6 import *\nwhile True:\n    salidaDigital(1, 1)\n    d = entradaDigital(1)\n",
  );
  assert.match(program, /from EDA6 import \*/);
  assert.match(program, /while True:/);
  assert.match(program, /_pybot_cleanup_normal/);
});

test("USB hash sync: matching exact file → no reinstall; stale → install", async () => {
  const bundled = read("src/assets/EDA6.py");
  const want = eda6FileHash(bundled);
  assert.equal(eda6NeedsInstall(want, want), false);
  assert.equal(eda6NeedsInstall(null, want), true);
  assert.equal(eda6NeedsInstall("aa".repeat(32), want), true);

  const calls = [];
  const sessionMatch = {
    async execRaw(code) {
      calls.push({ op: "execRaw", code });
      return { stdout: `EDA6_HASH:${want}` };
    },
    async installFile(name, source) {
      calls.push({ op: "installFile", name, source });
    },
  };
  const ok = await ensureEda6OnSession(sessionMatch, { getSource: () => bundled });
  assert.equal(ok.updated, false);
  assert.equal(calls.some((c) => c.op === "installFile"), false);

  const calls2 = [];
  const sessionStale = {
    async execRaw(code) {
      calls2.push({ op: "execRaw", code });
      if (String(code).includes("EDA6_HASH") || String(code).includes("open('EDA6.py'")) {
        return { stdout: "EDA6_HASH:" + "11".repeat(32) };
      }
      return { stdout: "" };
    },
    async installFile(name, source) {
      calls2.push({ op: "installFile", name, source });
    },
  };
  const stale = await ensureEda6OnSession(sessionStale, { getSource: () => bundled });
  assert.equal(stale.updated, true);
  assert.equal(calls2.some((c) => c.op === "installFile" && c.name === "EDA6.py"), true);
});

test("BLE assert rejects non-canonical EDA6 silently present", async () => {
  const bundled = read("src/assets/EDA6.py");
  assert.ok(eda6CanonicalHash(bundled));
  const session = {
    async execRaw() {
      return { stdout: "EDA6_HASH:" + "00".repeat(32) };
    },
    async installFile() {
      throw new Error("should_not_install_over_ble");
    },
  };
  await assert.rejects(
    () => assertEda6CanonicalOnSession(session, { getSource: () => bundled }),
    /EDA6_NEED_USB_SYNC/,
  );
  assert.equal(parseEda6HashProbe("EDA6_HASH:" + "ab".repeat(32)), "ab".repeat(32));
});

test("EDA6 input simulation (fake machine): dig/analog original + profile + Run-Stop-Run", () => {
  const py = findPython();
  assert.ok(py, "python required for EDA6 input simulation");
  const sim = join(__dirname, "helpers", "eda6InputSim.py");
  const eda6 = join(root, "src", "assets", "EDA6.py");
  const r = spawnSync(py, [sim, eda6], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(String(r.stdout).trim().split("\n").pop());
  assert.equal(data.ok, true);
  assert.equal(data.hasVersion, false);
  assert.deepEqual(data.dig, [1, 0, 1, 0]);
  assert.equal(data.a3, 100);
  assert.equal(data.pullDown, true);
  assert.equal(data.profileOk, true);
  assert.equal(data.servoOk, true);
  assert.equal(data.motorOk, true);
  assert.equal(data.runStopRunOk, true);
});
