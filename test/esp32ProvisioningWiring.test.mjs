import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PYBOT_RUNTIME_FILES, expectedProvisionFiles } from "../src/esp32/pybotInstallManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("provision file list matches getBleRuntimeInstallFiles + EDA6.py", () => {
  const runtime = read("src/pybotBleRuntime.js");
  assert.match(runtime, /export function getBleRuntimeInstallFiles/);
  assert.match(runtime, /BLE_BOOT_FILENAME/);
  for (const name of PYBOT_RUNTIME_FILES) {
    assert.ok(runtime.includes(`"${name}"`) || runtime.includes(`'${name}'`), name);
  }
  const extra = expectedProvisionFiles();
  assert.ok(extra.includes("EDA6.py"));
  assert.ok(extra.includes("pybot_repl.py"));
  assert.ok(extra.includes("pybot_net.py"));
  assert.ok(extra.includes("boot.py"));
});

test("prepareEsp32 reuses installBleRuntime (no duplicate student-program flash)", () => {
  const bridge = read("src/hardwareBridge.js");
  assert.match(bridge, /export async function prepareEsp32/);
  assert.match(bridge, /installBleRuntime/);
  assert.match(bridge, /runEsp32Provisioning/);
  const start = bridge.indexOf("export async function prepareEsp32");
  const after = bridge.indexOf("\nexport ", start + 1);
  const prepareBody = bridge.slice(start, after >= 0 ? after : undefined);
  assert.match(prepareBody, /installPybot/);
  assert.doesNotMatch(prepareBody, /prepareMainPyForGpioFlash/);
  assert.doesNotMatch(prepareBody, /pybot_app\.py/);
});

test("esptool-js is loaded only via dynamic import", () => {
  const loader = read("src/esp32/esptoolLoader.js");
  assert.match(loader, /import\("esptool-js"\)/);
  const flasher = read("src/esp32/esp32Flasher.js");
  assert.doesNotMatch(flasher, /from ["']esptool-js["']/);
  const bridge = read("src/hardwareBridge.js");
  assert.doesNotMatch(bridge, /from ["']esptool-js["']/);
  const ide = read("src/PyBotIDE.jsx");
  assert.doesNotMatch(ide, /from ["']esptool-js["']/);
});

test("Arduino Firmata / Pyodide / VM paths stay intact", () => {
  const bridge = read("src/hardwareBridge.js");
  assert.match(bridge, /flashStandardFirmata/);
  assert.match(bridge, /downloadToArduino/);
  assert.match(bridge, /arduino-firmata/);
  const ide = read("src/PyBotIDE.jsx");
  assert.match(ide, /downloadToArduino/);
  const pyodide = read("src/pyodideRunner.js");
  assert.doesNotMatch(pyodide, /prepareEsp32/);
});

test("i18n es/en include Prepare ESP32 strings (no coming-soon copy)", () => {
  const i18n = read("src/i18n.js");
  assert.match(i18n, /prepareEsp32Btn:/);
  assert.match(i18n, /Prepare ESP32/);
  assert.match(i18n, /Preparar ESP32/);
  assert.doesNotMatch(i18n, /Coming soon: a .Prepare ESP32. button/);
  assert.doesNotMatch(i18n, /Próximamente: botón .Preparar ESP32/);
  for (const key of [
    "prepareEsp32Ready",
    "prepareEsp32ConfirmFlash",
    "prepareEsp32Unsupported",
    "provErr_FLASH_FAIL",
    "mpyStateMpyOnly",
    "mpyStateOldPybot",
    "pybotUpdateBtn",
  ]) {
    const re = new RegExp(key + ":");
    const matches = i18n.match(new RegExp(key + ":", "g")) || [];
    assert.equal(matches.length, 2, key + " should exist in es and en");
    assert.match(i18n, re);
  }
});

test("UI wires Prepare ESP32 for disconnected ESP32 boards", () => {
  const ide = read("src/PyBotIDE.jsx");
  assert.match(ide, /openPrepareEsp32/);
  assert.match(ide, /PrepareEsp32Modal/);
  assert.match(ide, /prepareEsp32Btn/);
  const modal = read("src/ConnectUsbModal.jsx");
  assert.match(modal, /onPrepareEsp32/);
  assert.match(modal, /highlightPrepare/);
});
