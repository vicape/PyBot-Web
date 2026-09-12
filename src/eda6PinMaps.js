/**
 * Mapas de pines EDA6 y hints de hardware (sin imports Vite ?raw).
 * Fuente de verdad de PIN_MAPS para web + detector ADC2/Wi-Fi.
 */

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

/**
 * GPIOs del ESP32 clásico en ADC2 (comparten recursos con Wi-Fi).
 * No es una lista de puertos EDA6: se cruza con PIN_MAPS.adc_inputs.
 */
const ESP32_CLASSIC_ADC2_GPIOS = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]);

/** Quita comentarios # y vacía literales de string para escanear llamadas. */
function normalizePythonSourceForScan(code) {
  const lines = String(code ?? "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    let line = "";
    let inStr = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === "#") break;
      line += c;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * True si el código WEMOS puede leer ADC2 vía entradaAnalogica (puertos 1/2).
 * Conservador con argumentos no literales. No mira sensorDistancia ni Wi-Fi activo.
 * @param {string} code
 * @param {string} [profile]
 */
export function detectEda6Adc2Risk(code, profile = "WEMOS") {
  if (profile !== "WEMOS") return false;
  const pins = PIN_MAPS.WEMOS?.adc_inputs;
  if (!Array.isArray(pins) || pins.length === 0) return false;
  const riskyPorts = new Set();
  for (let i = 0; i < pins.length; i++) {
    if (ESP32_CLASSIC_ADC2_GPIOS.has(Number(pins[i]))) riskyPorts.add(i + 1);
  }
  if (riskyPorts.size === 0) return false;

  const src = normalizePythonSourceForScan(code);
  const re = /\bentradaAnalogica\s*\(\s*([^)]*?)\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const arg = String(m[1] ?? "").trim();
    if (!arg) continue;
    if (/^\d+$/.test(arg)) {
      const n = Number(arg);
      if (riskyPorts.has(n)) return true;
      continue;
    }
    // Argumento dinámico: puede ser 1 o 2 → advertir.
    return true;
  }
  return false;
}
