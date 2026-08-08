/**
 * Protocolo PyBot BLE (capa pura, sin dependencias del navegador).
 *
 * Define los UUID del servicio, los comandos MVP y utilidades puras para:
 *   - derivar el Device ID estable desde la MAC/uniqueId,
 *   - construir el nombre BLE (PYBOT-XXXXXX),
 *   - construir comandos y clasificar/parsear respuestas,
 *   - simular la respuesta del runtime (espejo del firmware) para tests/doc.
 *
 * Este modulo es JS puro y testeable en Node sin navegador ni ESP32.
 */

// UUIDs (deben coincidir con firmware/pybot-ble-runtime/main.py).
export const SERVICE_UUID = "8fbc0001-4d5a-4b8c-9a1f-123456789001";
export const RX_UUID = "8fbc0002-4d5a-4b8c-9a1f-123456789002"; // Web -> ESP32 (WRITE)
export const TX_UUID = "8fbc0003-4d5a-4b8c-9a1f-123456789003"; // ESP32 -> Web (NOTIFY)

export const PYBOT_RUNTIME_VERSION = "1.0.0";
export const PYBOT_PROTOCOL_VERSION = "1.0";
export const PYBOT_RUNTIME_NAME = "PyBot BLE Runtime";
export const PYBOT_BOARD = "ESP32";

export const MAX_COMMAND_LENGTH = 64;
export const MSG_DELIMITER = "\n";

export const COMMANDS = Object.freeze({
  PING: "PING",
  INFO: "INFO",
  LED_ON: "LED,1",
  LED_OFF: "LED,0",
});

/**
 * Device ID estable: ultimos 6 hex (MAYUSCULA) de la MAC/uniqueId.
 * Acepta "A3:4F:21:.." , "a34f21bc" , bytes separados por espacios, etc.
 * @param {string} mac
 * @returns {string} p.ej. "A34F21"
 */
export function deviceIdFromMac(mac) {
  const hex = String(mac ?? "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 6) {
    return hex.toUpperCase().padStart(6, "0");
  }
  return hex.slice(-6).toUpperCase();
}

/** @param {string} deviceId @returns {string} "PYBOT-XXXXXX" */
export function bleNameFromDeviceId(deviceId) {
  return "PYBOT-" + String(deviceId ?? "").toUpperCase();
}

/** @param {string} mac @returns {string} "PYBOT-XXXXXX" */
export function bleNameFromMac(mac) {
  return bleNameFromDeviceId(deviceIdFromMac(mac));
}

/** Comando LED en el formato del protocolo. @param {boolean} on */
export function buildLedCommand(on) {
  return on ? COMMANDS.LED_ON : COMMANDS.LED_OFF;
}

/**
 * Clasifica una respuesta del runtime.
 * @param {string} raw
 * @returns {"PONG"|"OK"|"INFO"|"ERROR"|"UNKNOWN"}
 */
export function classifyResponse(raw) {
  const text = String(raw ?? "").trim();
  if (text === "PONG") return "PONG";
  if (text === "OK") return "OK";
  if (text.startsWith("ERR")) return "ERROR";
  if (text.startsWith("{") && text.endsWith("}")) return "INFO";
  return "UNKNOWN";
}

/**
 * Parsea la respuesta INFO (JSON compacto). Devuelve null si no es valida.
 * @param {string} raw
 * @returns {null | {device:string,id:string,firmware:string,protocol:string,runtime:string,board:string}}
 */
export function parseInfoResponse(raw) {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") return obj;
    return null;
  } catch {
    return null;
  }
}

/**
 * Espejo JS del CommandProcessor del firmware (para tests y documentacion).
 * No toca hardware real; `ledOn` refleja el estado simulado del LED.
 * @param {string} command
 * @param {{ deviceName?:string, deviceId?:string, hasLed?:boolean }} [ctx]
 * @returns {null | string} respuesta (null si el comando vacio debe ignorarse)
 */
export function simulateDeviceResponse(command, ctx = {}) {
  const deviceName = ctx.deviceName ?? "PYBOT-A34F21";
  const deviceId = ctx.deviceId ?? "A34F21";
  const hasLed = ctx.hasLed !== false;

  if (command == null) return null;
  const text = String(command).trim();
  if (!text) return null;
  if (text.length > MAX_COMMAND_LENGTH) return "ERR,TOO_LONG";

  const upper = text.toUpperCase();
  if (upper === COMMANDS.PING) return "PONG";
  if (upper === COMMANDS.INFO) {
    return JSON.stringify({
      device: deviceName,
      id: deviceId,
      firmware: PYBOT_RUNTIME_VERSION,
      protocol: PYBOT_PROTOCOL_VERSION,
      runtime: PYBOT_RUNTIME_NAME,
      board: PYBOT_BOARD,
    });
  }
  if (upper === COMMANDS.LED_ON) return hasLed ? "OK" : "ERR,NO_LED";
  if (upper === COMMANDS.LED_OFF) return hasLed ? "OK" : "ERR,NO_LED";
  return "ERR,UNKNOWN_COMMAND";
}

/**
 * Divide un stream de texto acumulado en mensajes completos por el delimitador.
 * Devuelve { messages, rest } donde rest es el fragmento incompleto pendiente.
 * @param {string} buffer
 * @returns {{ messages: string[], rest: string }}
 */
export function splitMessages(buffer) {
  const parts = String(buffer ?? "").split(MSG_DELIMITER);
  const rest = parts.pop() ?? "";
  const messages = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return { messages, rest };
}
