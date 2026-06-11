/**
 * Perfil EDA6 para PyBot-Web: mapas de pines, librería, transformadores de código.
 * No reemplaza PyBot Core; es una capa compatible con programas Thonny/EDA6.
 */

import eda6LibraryRaw from "./assets/EDA6.py?raw";

export const PIN_MAPS = {
  WEMOS: {
    digital_outputs: [26, 17, 27, 12],
    adc_inputs: [2, 4, 35, 34],
    digital_inputs: [5, 23, 19, 18],
    servo_pins: [25, 16, 14, 13],
    I2C: [22, 21],
  },
  ESP32: {
    digital_outputs: [32, 25, 27, 12],
    adc_inputs: [35, 34, 39, 36],
    digital_inputs: [4, 2, 15, 0],
    servo_pins: [33, 26, 14, 13],
    I2C: [22, 21],
  },
};

export const EDA6_PUBLIC_FUNCS = [
  "entradaDigital",
  "entradaAnalogica",
  "salidaDigital",
  "motorRC",
  "servomotor",
  "sensorDistancia",
  "detenerTodo",
  "printLCD",
  "limpiarLCD",
  "asciiLCD",
  "luzLCD",
  "cursorLCD",
  "parpadeoLCD",
];

const EDA6_IMPORT_RE = /^\s*from\s+EDA6\s+import\s+.+\s*$/gm;
const EDA6_FUNC_RE = new RegExp(`\\b(${EDA6_PUBLIC_FUNCS.join("|")})\\s*\\(`);

export function getEda6Profile() {
  try {
    const v = localStorage.getItem("pybot_eda6_profile");
    if (v === "ESP32") return "ESP32";
    return "WEMOS";
  } catch {
    return "WEMOS";
  }
}

export function setEda6Profile(profile) {
  localStorage.setItem("pybot_eda6_profile", profile === "ESP32" ? "ESP32" : "WEMOS");
}

/** Texto de EDA6.py listo para grabar en la placa (Thonny-compatible). */
export function getEda6LibrarySource(profile = getEda6Profile()) {
  const placa = profile === "ESP32" ? "ESP32" : "WEMOS";
  return eda6LibraryRaw.replace(/PLACA_ACTUAL\s*=\s*"[^"]*"/, `PLACA_ACTUAL = "${placa}"`);
}

/** Prelude inyectado en ejecución rápida (sin import EDA6). */
export function getEda6ExecPrelude(profile = getEda6Profile()) {
  return getEda6LibrarySource(profile);
}

export function isEda6ImportLine(line) {
  return /^\s*from\s+EDA6\s+import\s+/i.test(String(line ?? ""));
}

export function detectEda6Usage(code) {
  return EDA6_FUNC_RE.test(String(code ?? ""));
}

export function detectPybotGpioUsage(code) {
  const s = String(code ?? "");
  return /\b(pin|motor|servo|wait)\s*\(/.test(s);
}

/** Quita imports EDA6; deja time.sleep y el resto intacto. */
export function prepareUserCodeForExec(code) {
  return String(code ?? "")
    .replace(EDA6_IMPORT_RE, "")
    .replace(/^\s*\n/gm, "\n")
    .trimStart();
}

/** Genera main.py corto compatible con Thonny. */
export function prepareMainPyForFlash(code) {
  const body = prepareUserCodeForExec(code);
  const lines = [
    "from EDA6 import *",
    "from time import sleep",
    "",
    body,
    "",
  ];
  return lines.join("\n");
}

export function filterExamplesForBoard(examples, boardType) {
  const arduinoHw = new Set(["blink", "motor", "servo", "light_sensor", "button"]);
  const esp32Gpio = new Set([
    "esp32_blink",
    "esp32_digital_in",
    "esp32_analog_in",
    "esp32_pwm",
  ]);

  return examples.filter((ex) => {
    if (ex.boards?.includes("esp32-eda6")) {
      return boardType === "esp32-eda6";
    }
    if (boardType === "esp32-eda6") {
      if (arduinoHw.has(ex.id) || esp32Gpio.has(ex.id)) return false;
    }
    return true;
  });
}
