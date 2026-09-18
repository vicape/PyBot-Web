/**
 * Punto 14: warning educativo ADC2/Wi-Fi para EDA6 WEMOS (IDE, no EDA6.py).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIN_MAPS,
  detectEda6Adc2Risk,
} from "../src/eda6PinMaps.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("TEST1: WEMOS entradaAnalogica(1) → risk", () => {
  assert.equal(detectEda6Adc2Risk("x = entradaAnalogica(1)\n", "WEMOS"), true);
});

test("TEST2: WEMOS entradaAnalogica(2) → risk", () => {
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(2)", "WEMOS"), true);
});

test("TEST3: WEMOS entradaAnalogica(3) → no risk", () => {
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(3)", "WEMOS"), false);
});

test("TEST4: WEMOS entradaAnalogica(4) → no risk", () => {
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(4)", "WEMOS"), false);
});

test("TEST5: perfil ESP32 → no risk", () => {
  assert.equal(detectEda6Adc2Risk("entradaAnalogica(1)", "ESP32"), false);
});

test("TEST6: argumento variable → risk conservador", () => {
  assert.equal(
    detectEda6Adc2Risk("p = 1\nvalor = entradaAnalogica(p)\n", "WEMOS"),
    true,
  );
});

test("TEST7: varias lecturas → true una vez (booleano)", () => {
  const code = "entradaAnalogica(1)\nentradaAnalogica(2)\nentradaAnalogica(1)\n";
  assert.equal(detectEda6Adc2Risk(code, "WEMOS"), true);
});

test("TEST8: comentario no dispara", () => {
  assert.equal(detectEda6Adc2Risk("# entradaAnalogica(1)\n", "WEMOS"), false);
});

test("TEST9: sensorDistancia no dispara", () => {
  assert.equal(detectEda6Adc2Risk("sensorDistancia(1)\n", "WEMOS"), false);
});

test("TEST10: Wi-Fi + ADC2 → warning", () => {
  const code = 'wifi_conectar("red", "clave")\nx = entradaAnalogica(1)\n';
  assert.equal(detectEda6Adc2Risk(code, "WEMOS"), true);
});

test("TEST11: Wi-Fi + ADC1 → no warning ADC2", () => {
  const code = 'wifi_conectar("red", "clave")\nx = entradaAnalogica(3)\n';
  assert.equal(detectEda6Adc2Risk(code, "WEMOS"), false);
});

test("TEST12: Run wiring — warning antes de runOnBoard, no bloquea", () => {
  const ide = read("src/PyBotIDE.jsx");
  const runIdx = ide.indexOf("const onRun = useCallback");
  const runBlock = ide.slice(runIdx, ide.indexOf("const onDisconnect", runIdx));
  // runBoardProgram wraps runOnBoard; warning must appear before runBoardProgram
  const warnAt = runBlock.indexOf("detectEda6Adc2Risk(activeCode, eda6Profile)");
  const runAt = runBlock.indexOf("await runBoardProgram");
  assert.ok(warnAt >= 0);
  assert.ok(runAt > warnAt);
  assert.match(runBlock, /t\("eda6Adc2WifiWarning"\)/);
  assert.doesNotMatch(runBlock, /window\.alert|window\.confirm|return;\s*\n\s*await runBoardProgram/);
});

test("TEST13: Flash wiring — detector antes de flashToEsp32, no bloquea", () => {
  const ide = read("src/PyBotIDE.jsx");
  const flashIdx = ide.indexOf("const onFlashToEsp32 = useCallback");
  const flashBlock = ide.slice(flashIdx, ide.indexOf("const onDownloadToArduino", flashIdx));
  const warnAt = flashBlock.indexOf("detectEda6Adc2Risk(activeCode, eda6Profile)");
  const flashAt = flashBlock.indexOf("await flashToEsp32");
  assert.ok(warnAt >= 0);
  assert.ok(flashAt > warnAt);
  assert.match(flashBlock, /t\("eda6Adc2WifiWarning"\)/);
});

test("TEST14: mensajes i18n ES/EN", () => {
  const i18n = read("src/i18n.js");
  assert.match(i18n, /eda6Adc2WifiWarning:\s*\n\s*"Aviso WEMOS:.*ADC2/);
  assert.match(i18n, /eda6Adc2WifiWarning:\s*\n\s*"WEMOS warning:.*ADC2/);
});

test("TEST15: PIN_MAPS intactos", () => {
  assert.deepEqual(PIN_MAPS.WEMOS.adc_inputs, [2, 4, 35, 34]);
  assert.deepEqual(PIN_MAPS.ESP32.adc_inputs, [35, 34, 39, 36]);
});

test("string literal no dispara falso positivo", () => {
  assert.equal(detectEda6Adc2Risk('print("entradaAnalogica(1)")\n', "WEMOS"), false);
});

test("EDA6.py declares ADC2 Wi-Fi conflict; IDE warning still present", () => {
  const eda6 = read("src/assets/EDA6.py");
  assert.match(eda6, /EDA6_VERSION\s*=\s*"1\.1\.1"/);
  assert.match(eda6, /EDA6_ADC2_WIFI_CONFLICT/);
  const ensure = read("src/eda6Ensure.js");
  assert.match(ensure, /1\.1\.1/);
});
