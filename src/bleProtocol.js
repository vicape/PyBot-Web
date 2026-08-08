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

export const PYBOT_RUNTIME_VERSION = "2.0.0";
// Protocolo 2.0: agrega ejecucion de programas (RUN/OUT/STOP). PING/INFO/LED intactos.
export const PYBOT_PROTOCOL_VERSION = "2.0";
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
 * Determina si el runtime instalado en la placa (segun su INFO) entiende el
 * protocolo de EJECUCION (RUN 2.0). El MVP viejo (firmware/protocolo 1.x) solo
 * respondia PING/INFO/LED: nunca contesta RUN:READY y provoca un timeout.
 *
 * Conservador: solo devuelve `false` cuando puede CONFIRMAR una version vieja
 * (mayor < 2). Sin datos o formato desconocido -> `true` (no bloquear; que el
 * flujo RUN maneje el timeout como fallback).
 *
 * @param {null | { protocol?: string, firmware?: string }} info
 * @returns {boolean}
 */
export function runtimeSupportsRun(info) {
  if (!info || typeof info !== "object") return true;
  const major = (v) => {
    const n = parseInt(String(v ?? "").split(".")[0], 10);
    return Number.isFinite(n) ? n : null;
  };
  const proto = major(info.protocol);
  if (proto != null) return proto >= 2;
  const fw = major(info.firmware);
  if (fw != null) return fw >= 2;
  return true;
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

// ===========================================================================
// Protocolo de EJECUCION sobre GATT (protocolo 2.0)
// ---------------------------------------------------------------------------
// El codigo del alumno se envia por RX en varios paquetes (base64) y la salida
// se recibe por TX en tiempo real (base64). Framing por lineas ('\n'); los
// payloads binarios/arbitrarios (codigo, OUT, ERR) van en base64 para no chocar
// con el delimitador. Los preludios (MPY/EDA6) viven como archivos .py en la
// placa: por BLE solo viaja el codigo del alumno + modo + perfil.
// ===========================================================================

/** Tamano maximo del programa del alumno (bytes de fuente UTF-8) transferible por BLE. */
export const MAX_PROGRAM_LENGTH = 8192;

/** Bytes de fuente por chunk antes de base64 (chico para tolerar el MTU BLE). */
export const RUN_SOURCE_CHUNK = 96;

/** Modos de ejecucion soportados por el runtime. */
export const RUN_MODES = Object.freeze({ MPY: "mpy", EDA6: "eda6" });

/** Perfiles EDA6 validos (deben coincidir con eda6Profile.js / EDA6.py). */
export const RUN_PROFILES = Object.freeze({ WEMOS: "WEMOS", ESP32: "ESP32" });

/** Tokens del protocolo de ejecucion (deben coincidir con el firmware). */
export const RUN = Object.freeze({
  // PyBot Web -> ESP32
  BEGIN: "RUN:BEGIN", // RUN:BEGIN:<mode>:<profile>
  CHUNK: "RUN:CHUNK", // RUN:CHUNK:<base64>
  END: "RUN:END", // fin de la transferencia -> ejecutar
  STOP: "STOP", // abortar ejecucion
  // ESP32 -> PyBot Web
  READY: "RUN:READY", // listo para recibir chunks
  STARTED: "RUN:STARTED", // el programa empezo a ejecutarse
  OUT: "RUN:OUT", // RUN:OUT:<base64> (stdout del programa)
  ERR: "RUN:ERR", // RUN:ERR:<base64> (traceback / error de runtime)
  DONE: "RUN:DONE", // el programa termino (normal o detenido)
  ERROR: "RUN:ERROR", // RUN:ERROR:<code> (error de protocolo)
});

const _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Codifica bytes a base64 (JS puro, identico en Node y navegador; compatible con
 * ubinascii.a2b_base64 del firmware). @param {Uint8Array|number[]} bytes @returns {string}
 */
export function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const b0 = b[i];
    const b1 = i + 1 < b.length ? b[i + 1] : 0;
    const b2 = i + 2 < b.length ? b[i + 2] : 0;
    out += _B64[b0 >> 2];
    out += _B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < b.length ? _B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < b.length ? _B64[b2 & 63] : "=";
  }
  return out;
}

/** Decodifica base64 a bytes (JS puro). @param {string} b64 @returns {Uint8Array} */
export function base64ToBytes(b64) {
  const s = String(b64 ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
  const clean = s.replace(/=+$/, "");
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = _B64.indexOf(clean[i]);
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/** @param {string} text @returns {string} */
export function utf8ToBase64(text) {
  return bytesToBase64(_enc.encode(String(text ?? "")));
}

/** @param {string} b64 @returns {string} */
export function base64ToUtf8(b64) {
  return _dec.decode(base64ToBytes(b64));
}

/** @param {"mpy"|"eda6"} mode @param {"WEMOS"|"ESP32"} profile @returns {string} */
export function buildRunBegin(mode, profile) {
  const m = mode === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
  const p = profile === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
  return `${RUN.BEGIN}:${m}:${p}`;
}

/** @param {string} b64Chunk @returns {string} */
export function buildRunChunk(b64Chunk) {
  return `${RUN.CHUNK}:${b64Chunk}`;
}

/**
 * Parsea `RUN:BEGIN:<mode>:<profile>` (usado por el espejo/tests del firmware).
 * @param {string} line @returns {null | { mode:string, profile:string }}
 */
export function parseRunBegin(line) {
  const text = String(line ?? "").trim();
  if (!text.startsWith(RUN.BEGIN + ":")) return null;
  const rest = text.slice(RUN.BEGIN.length + 1);
  const parts = rest.split(":");
  const mode = (parts[0] || "").toLowerCase() === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
  const profile = (parts[1] || "").toUpperCase() === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
  return { mode, profile };
}

/**
 * Parte el codigo fuente en chunks base64 listos para enviar como RUN:CHUNK.
 * @param {string} code @param {number} [chunkBytes]
 * @returns {string[]} lista de fragmentos base64
 */
export function chunkProgram(code, chunkBytes = RUN_SOURCE_CHUNK) {
  const bytes = _enc.encode(String(code ?? ""));
  const size = chunkBytes > 0 ? chunkBytes : RUN_SOURCE_CHUNK;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytesToBase64(bytes.subarray(i, i + size)));
  }
  return chunks;
}

/**
 * Reensambla una lista de chunks base64 en el texto original (inverso de chunkProgram).
 * @param {string[]} b64Chunks @returns {string}
 */
export function reassembleProgram(b64Chunks) {
  const parts = Array.isArray(b64Chunks) ? b64Chunks : [];
  const out = [];
  for (const c of parts) {
    const bytes = base64ToBytes(c);
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
  }
  return _dec.decode(Uint8Array.from(out));
}

/**
 * Parsea un frame recibido del runtime durante la ejecucion (TX -> Web).
 * @param {string} raw
 * @returns {{ type:"ready"|"started"|"out"|"err"|"done"|"error"|"unknown", text?:string, code?:string, raw:string }}
 */
export function parseRunFrame(raw) {
  const text = String(raw ?? "").trim();
  if (text === RUN.READY) return { type: "ready", raw: text };
  if (text === RUN.STARTED) return { type: "started", raw: text };
  if (text === RUN.DONE) return { type: "done", raw: text };
  if (text.startsWith(RUN.OUT + ":")) {
    return { type: "out", text: base64ToUtf8(text.slice(RUN.OUT.length + 1)), raw: text };
  }
  if (text.startsWith(RUN.ERR + ":")) {
    return { type: "err", text: base64ToUtf8(text.slice(RUN.ERR.length + 1)), raw: text };
  }
  if (text.startsWith(RUN.ERROR + ":")) {
    return { type: "error", code: text.slice(RUN.ERROR.length + 1), raw: text };
  }
  return { type: "unknown", raw: text };
}
