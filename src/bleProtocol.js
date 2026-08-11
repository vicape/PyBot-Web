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

// ===========================================================================
// FUENTE DE VERDAD UNICA de la version del runtime publicada por esta version de
// PyBot Web. El firmware (main.py) declara la MISMA version por INFO. La web
// compara la version INSTALADA (INFO.firmware) contra PYBOT_RUNTIME_VERSION para
// decidir si ofrecer una actualizacion OTA por BLE. NO duplicar esta constante:
// pybotBleRuntime.js la reexporta; los tests y la UI la importan de aca.
// ===========================================================================
export const PYBOT_RUNTIME_VERSION = "3.1.0";
// Protocolo 3.0: STOP confiable (RUN:STOPPED + STOP:FORCE), DEPLOY persistente
// verificado (size+hash), control de app (APP:*) y autostart con safe boot.
// El protocolo 2.0 (solo RUN/OUT/STOP) sigue siendo compatible para RUN.
// 3.0.1 (runtime, framing compatible): DEPLOY transaccional con backup/rollback,
// HASH obligatorio si se declara (DEPLOY:ERROR:HASH_UNAVAILABLE), APP:STOP/DELETE
// confirmados de verdad y errores de filesystem explicitos (APP:ERROR:*).
// 3.1 (extension COMPATIBLE): agrega la actualizacion OTA del propio runtime por
// BLE (UPDATE:*), con verificacion SHA-256, apply transaccional (boot.py) y
// rollback. Se sube el protocolo a 3.1 porque agrega comandos nuevos versionados
// (aditivos, no rompen 3.0) y el runtime a 3.1.0. La capability "runtime-update"
// permite a la web decidir por capabilities (no por numero de version).
export const PYBOT_PROTOCOL_VERSION = "3.1";
export const PYBOT_RUNTIME_NAME = "PyBot BLE Runtime";
export const PYBOT_BOARD = "ESP32";

/** Capacidades declaradas por el runtime (via INFO). */
export const PYBOT_CAPABILITIES = Object.freeze([
  "run",
  "stop",
  "deploy",
  "app-control",
  "autostart",
  "runtime-update",
]);

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
 * Devuelve la lista de capabilities declaradas por el runtime (via INFO), o [].
 * @param {null | { capabilities?: string[] }} info
 * @returns {string[]}
 */
export function parseCapabilities(info) {
  if (!info || typeof info !== "object") return [];
  const caps = info.capabilities;
  if (!Array.isArray(caps)) return [];
  return caps.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
}

/**
 * Determina si el runtime soporta DEPLOY persistente por BLE. Prefiere las
 * `capabilities` declaradas (fuente confiable) sobre inferencias por version.
 * Conservador: solo `true` cuando puede CONFIRMAR el soporte (capability
 * "deploy" o protocolo/firmware mayor >= 3). El runtime 2.x permite RUN pero no
 * DEPLOY: en ese caso `false` y la web sugiere actualizar el runtime.
 *
 * @param {null | { protocol?: string, firmware?: string, capabilities?: string[] }} info
 * @returns {boolean}
 */
export function runtimeSupportsDeploy(info) {
  const caps = parseCapabilities(info);
  if (caps.includes("deploy")) return true;
  if (!info || typeof info !== "object") return false;
  const major = (v) => {
    const n = parseInt(String(v ?? "").split(".")[0], 10);
    return Number.isFinite(n) ? n : null;
  };
  const proto = major(info.protocol);
  if (proto != null) return proto >= 3;
  const fw = major(info.firmware);
  if (fw != null) return fw >= 3;
  return false;
}

/**
 * Determina si el runtime soporta la ACTUALIZACION OTA por BLE (UPDATE:*).
 * Estrictamente por capability (fuente confiable): una placa 3.0.x NO declara
 * "runtime-update" y por lo tanto necesita una ultima actualizacion por USB para
 * habilitar el OTA. No se infiere por numero de version (evita falsos positivos).
 * @param {null | { capabilities?: string[] }} info
 * @returns {boolean}
 */
export function runtimeSupportsUpdate(info) {
  return parseCapabilities(info).includes("runtime-update");
}

/**
 * Compara dos versiones "x.y.z" numericamente. Devuelve -1 si a<b, 0 si igual,
 * 1 si a>b. Tolerante: partes no numericas o faltantes cuentan como 0. Cualquier
 * entrada invalida se trata conservadoramente como "igual" (0) para no ofrecer
 * actualizaciones espurias.
 * @param {string} a @param {string} b @returns {-1|0|1}
 */
export function compareRuntimeVersions(a, b) {
  const parse = (v) =>
    String(v ?? "")
      .trim()
      .split(".")
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Estado de actualizacion del runtime BLE segun el INFO instalado y la version
 * PUBLICADA por esta version de PyBot Web (fuente de verdad unica). No decide por
 * si sola instalar nada: solo informa para que la UI ofrezca (no silenciosa) la
 * actualizacion.
 *
 * @param {null | { firmware?: string, capabilities?: string[] }} info
 * @param {string} [published] version publicada (default: PYBOT_RUNTIME_VERSION)
 * @returns {{ installed:string|null, latest:string, updateAvailable:boolean,
 *             supportsOta:boolean, canUpdateOta:boolean, needsUsb:boolean }}
 */
export function runtimeUpdateStatus(info, published = PYBOT_RUNTIME_VERSION) {
  const installed =
    info && typeof info === "object" && info.firmware
      ? String(info.firmware)
      : null;
  const latest = String(published);
  const supportsOta = runtimeSupportsUpdate(info);
  // Solo hay actualizacion disponible si conocemos la version instalada y es
  // ESTRICTAMENTE menor que la publicada.
  const updateAvailable =
    installed != null && compareRuntimeVersions(installed, latest) < 0;
  return {
    installed,
    latest,
    updateAvailable,
    supportsOta,
    // Se puede actualizar por BLE si hay novedad Y la placa declara el canal OTA.
    canUpdateOta: updateAvailable && supportsOta,
    // Hay novedad pero la placa (p.ej. 3.0.x) no expone OTA: requiere USB una vez.
    needsUsb: updateAvailable && !supportsOta,
  };
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
      capabilities: [...PYBOT_CAPABILITIES],
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

/** Tamano maximo del programa del alumno para RUN temporal (bytes de fuente UTF-8). */
export const MAX_RUN_PROGRAM_SIZE = 8192;

/** Tamano maximo del programa persistente (DEPLOY): se escribe a flash por chunks. */
export const MAX_DEPLOY_PROGRAM_SIZE = 16384;

/**
 * Alias historico de MAX_RUN_PROGRAM_SIZE (RUN temporal). Se mantiene para no
 * romper llamadores existentes; nuevos usos deben preferir los nombres explicitos.
 */
export const MAX_PROGRAM_LENGTH = MAX_RUN_PROGRAM_SIZE;

/** Bytes de fuente por chunk antes de base64 (chico para tolerar el MTU BLE). */
export const RUN_SOURCE_CHUNK = 96;

/** Bytes de fuente por chunk DEPLOY antes de base64 (mas grande: ACK por bloque). */
export const DEPLOY_SOURCE_CHUNK = 192;

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
  STOP: "STOP", // abortar ejecucion (STOP cooperativo)
  STOP_FORCE: "STOP:FORCE", // recuperacion real: reset + safe boot (no cooperativo)
  // ESP32 -> PyBot Web
  READY: "RUN:READY", // listo para recibir chunks
  STARTED: "RUN:STARTED", // el programa empezo a ejecutarse
  OUT: "RUN:OUT", // RUN:OUT:<base64> (stdout del programa)
  ERR: "RUN:ERR", // RUN:ERR:<base64> (traceback / error de runtime)
  DONE: "RUN:DONE", // el programa termino normalmente
  STOPPED: "RUN:STOPPED", // el programa fue DETENIDO (confirmacion de STOP)
  ERROR: "RUN:ERROR", // RUN:ERROR:<code> (error de protocolo)
});

/** Tokens del protocolo DEPLOY (transferencia de la app persistente). */
export const DEPLOY = Object.freeze({
  // PyBot Web -> ESP32
  BEGIN: "DEPLOY:BEGIN", // DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash>
  CHUNK: "DEPLOY:CHUNK", // DEPLOY:CHUNK:<base64>
  END: "DEPLOY:END", // fin -> verificar + reemplazo atomico
  ABORT: "DEPLOY:ABORT", // cancelar transferencia (conserva app anterior)
  // ESP32 -> PyBot Web
  READY: "DEPLOY:READY", // listo para recibir chunks
  ACK: "DEPLOY:ACK", // DEPLOY:ACK:<n> (ACK por bloque, backpressure)
  VERIFY_OK: "DEPLOY:VERIFY:OK", // guardado y verificado (size+hash)
  ERROR: "DEPLOY:ERROR", // DEPLOY:ERROR:<code>
});

/** Codigos de error DEPLOY (deben coincidir con el firmware). */
export const DEPLOY_ERRORS = Object.freeze([
  "BUSY",
  "TOO_LONG",
  "BAD_ENCODING",
  "BAD_HASH",
  // Se declaro VERIFY por hash pero el port no tiene uhashlib: no se afirma una
  // verificacion criptografica que no ocurrio (la app anterior queda intacta).
  "HASH_UNAVAILABLE",
  "WRITE_FAILED",
  "VERIFY_FAILED",
  "INVALID_MODE",
  "INVALID_PROFILE",
  "NO_SPACE",
  "BAD_FRAME",
]);

/** Codigos de error APP:* que puede emitir el firmware (deben coincidir). */
export const APP_ERRORS = Object.freeze([
  "NO_APP",
  "BUSY",
  "READ_FAILED",
  "WRITE_FAILED",
  "DELETE_FAILED",
  "BAD_FRAME",
]);

/** Tokens del control de app persistente. */
export const APP = Object.freeze({
  // PyBot Web -> ESP32
  INFO: "APP:INFO",
  START: "APP:START",
  STOP: "APP:STOP",
  DELETE: "APP:DELETE",
  AUTOSTART: "APP:AUTOSTART", // APP:AUTOSTART:1 / APP:AUTOSTART:0
  // ESP32 -> PyBot Web
  INFO_PREFIX: "APP:INFO:", // APP:INFO:<json>
  OK_PREFIX: "APP:OK:", // APP:OK:<action>
  ERROR_PREFIX: "APP:ERROR:", // APP:ERROR:<code>
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
  if (text === RUN.STOPPED) return { type: "stopped", raw: text };
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

// ===========================================================================
// SHA-256 puro (JS) — identico en Node y navegador. Se usa para verificar la
// transferencia DEPLOY (el firmware calcula el mismo hash con uhashlib.sha256).
// ===========================================================================

const _SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function _rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/**
 * SHA-256 de un arreglo de bytes -> string hex (64 chars, minuscula).
 * @param {Uint8Array|number[]} bytes @returns {string}
 */
export function sha256Hex(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = msg.length * 8;
  const withOne = msg.length + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // Longitud (64 bits big-endian). bitLen cabe en 32 bits para nuestros tamanos.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3];
    let e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + _SHA_K[i] + w[i]) | 0;
      const S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  let out = "";
  for (let i = 0; i < 8; i++) {
    out += (h[i] >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

/** SHA-256 (hex) del texto UTF-8. @param {string} text @returns {string} */
export function sha256HexUtf8(text) {
  return sha256Hex(_enc.encode(String(text ?? "")));
}

// ===========================================================================
// Protocolo DEPLOY (app persistente) — builders + parser de frames
// ===========================================================================

/**
 * Construye DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash>.
 * @param {"mpy"|"eda6"} mode @param {"WEMOS"|"ESP32"} profile
 * @param {number} size (bytes de fuente UTF-8) @param {string} hash (sha256 hex)
 * @returns {string}
 */
export function buildDeployBegin(mode, profile, size, hash) {
  const m = mode === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
  const p = profile === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
  return `${DEPLOY.BEGIN}:${m}:${p}:${size}:${String(hash ?? "").toLowerCase()}`;
}

/** @param {string} b64Chunk @returns {string} */
export function buildDeployChunk(b64Chunk) {
  return `${DEPLOY.CHUNK}:${b64Chunk}`;
}

/**
 * Parsea un frame DEPLOY:* recibido del runtime (TX -> Web).
 * @param {string} raw
 * @returns {{ type:"ready"|"ack"|"verify_ok"|"error"|"unknown", index?:number, code?:string, raw:string }}
 */
export function parseDeployFrame(raw) {
  const text = String(raw ?? "").trim();
  if (text === DEPLOY.READY) return { type: "ready", raw: text };
  if (text === DEPLOY.VERIFY_OK) return { type: "verify_ok", raw: text };
  if (text.startsWith(DEPLOY.ACK + ":")) {
    const n = parseInt(text.slice(DEPLOY.ACK.length + 1), 10);
    return { type: "ack", index: Number.isFinite(n) ? n : -1, raw: text };
  }
  if (text.startsWith(DEPLOY.ERROR + ":")) {
    return { type: "error", code: text.slice(DEPLOY.ERROR.length + 1), raw: text };
  }
  return { type: "unknown", raw: text };
}

/**
 * Parte el codigo fuente en chunks base64 para DEPLOY (chunk mas grande que RUN).
 * @param {string} code @param {number} [chunkBytes]
 * @returns {string[]}
 */
export function chunkDeployProgram(code, chunkBytes = DEPLOY_SOURCE_CHUNK) {
  return chunkProgram(code, chunkBytes > 0 ? chunkBytes : DEPLOY_SOURCE_CHUNK);
}

// ===========================================================================
// Control de app persistente (APP:*) — builders + parser
// ===========================================================================

/** @param {boolean} on @returns {string} APP:AUTOSTART:1 / APP:AUTOSTART:0 */
export function buildAppAutostart(on) {
  return `${APP.AUTOSTART}:${on ? "1" : "0"}`;
}

/**
 * Parsea un frame APP:* recibido del runtime (TX -> Web).
 * @param {string} raw
 * @returns {{ type:"info"|"ok"|"error"|"unknown", info?:object|null, action?:string, code?:string, raw:string }}
 */
export function parseAppFrame(raw) {
  const text = String(raw ?? "").trim();
  if (text.startsWith(APP.INFO_PREFIX)) {
    return { type: "info", info: parseAppInfo(text), raw: text };
  }
  if (text.startsWith(APP.OK_PREFIX)) {
    return { type: "ok", action: text.slice(APP.OK_PREFIX.length), raw: text };
  }
  if (text.startsWith(APP.ERROR_PREFIX)) {
    return { type: "error", code: text.slice(APP.ERROR_PREFIX.length), raw: text };
  }
  return { type: "unknown", raw: text };
}

/**
 * Parsea la respuesta APP:INFO:<json> a objeto. Devuelve null si no es valida.
 * @param {string} raw
 * @returns {null | {installed:boolean, running:boolean, autostart:boolean, mode:string, profile:string, size:number, hash:string, safe:boolean, fail:number, error:string}}
 */
export function parseAppInfo(raw) {
  const text = String(raw ?? "").trim();
  const body = text.startsWith(APP.INFO_PREFIX) ? text.slice(APP.INFO_PREFIX.length) : text;
  if (!body.startsWith("{")) return null;
  try {
    const obj = JSON.parse(body);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Protocolo UPDATE (actualizacion OTA del propio runtime por BLE) — protocolo 3.1
// ---------------------------------------------------------------------------
// La ESP32 actualiza su PROPIO runtime (main.py) a una version mas nueva por BLE,
// de forma segura, verificada (SHA-256), transaccional y con rollback. El nuevo
// runtime NUNCA se escribe sobre main.py durante la transferencia: se descarga
// completo a pybot_runtime.new; boot.py aplica el swap con backup y rollback.
//
// Canal ADMINISTRATIVO: no se expone ninguna funcion educativa (no hay
// updateRuntime() para el alumno). Flujo:
//   UPDATE:INFO                          -> UPDATE:INFO:<json>
//   UPDATE:BEGIN:<version>:<size>:<hash> -> UPDATE:READY | UPDATE:ERROR:<code>
//   UPDATE:CHUNK:<base64>  (por bloque)  -> UPDATE:ACK:<n> | UPDATE:ERROR:<code>
//   UPDATE:END                           -> UPDATE:VERIFY:OK | UPDATE:ERROR:<code>
//   UPDATE:APPLY                         -> UPDATE:APPLYING (la placa resetea)
// ===========================================================================

/** Tamano maximo del runtime a actualizar por BLE (bytes de fuente UTF-8).
 *  Holgado para el runtime actual (~45 KB) sin agotar el filesystem tipico. */
export const MAX_RUNTIME_UPDATE_SIZE = 65536;

/** Bytes de fuente por chunk UPDATE antes de base64 (ACK por bloque, como DEPLOY). */
export const UPDATE_SOURCE_CHUNK = 192;

/** Tokens del protocolo UPDATE (deben coincidir con el firmware). */
export const UPDATE = Object.freeze({
  // PyBot Web -> ESP32
  INFO: "UPDATE:INFO", // consulta capacidades/version del updater
  BEGIN: "UPDATE:BEGIN", // UPDATE:BEGIN:<version>:<size>:<hash>
  CHUNK: "UPDATE:CHUNK", // UPDATE:CHUNK:<base64>
  END: "UPDATE:END", // fin -> verificar size+hash
  APPLY: "UPDATE:APPLY", // aplicar (boot.py hace el swap) -> la placa resetea
  ABORT: "UPDATE:ABORT", // cancelar transferencia (borra el .new; main.py intacto)
  // ESP32 -> PyBot Web
  INFO_PREFIX: "UPDATE:INFO:", // UPDATE:INFO:<json>
  READY: "UPDATE:READY", // listo para recibir chunks (.new abierto)
  ACK: "UPDATE:ACK", // UPDATE:ACK:<n> (ACK por bloque, backpressure)
  VERIFY_OK: "UPDATE:VERIFY:OK", // .new verificado (size+hash) — aun NO aplicado
  APPLYING: "UPDATE:APPLYING", // update pendiente escrito; la placa va a resetear
  ERROR: "UPDATE:ERROR", // UPDATE:ERROR:<code>
});

/** Codigos de error UPDATE (deben coincidir con el firmware). */
export const UPDATE_ERRORS = Object.freeze([
  "BUSY", // hay un RUN/APP/DEPLOY en curso: llevar a estado seguro primero
  "UNSUPPORTED", // el runtime no soporta OTA (no deberia ocurrir si hay capability)
  "BAD_VERSION", // version destino invalida / no mas nueva que la instalada
  "TOO_LONG", // supera MAX_RUNTIME_UPDATE_SIZE
  "BAD_ENCODING", // base64 invalido en un chunk
  "BAD_HASH", // el SHA-256 recalculado no coincide con el declarado
  "HASH_UNAVAILABLE", // no hay uhashlib: no se puede verificar -> NUNCA VERIFY:OK
  "WRITE_FAILED", // fallo de escritura en el filesystem
  "VERIFY_FAILED", // el tamano de .new no coincide con el declarado
  "NO_SPACE", // no hay espacio suficiente en el filesystem (statvfs)
  "BAD_FRAME", // frame UPDATE:* mal formado / fuera de secuencia
  "INCOMPATIBLE", // el nuevo runtime es incompatible con esta placa
]);

/**
 * Construye UPDATE:BEGIN:<version>:<size>:<hash>.
 * @param {string} version version del runtime destino (x.y.z)
 * @param {number} size bytes de fuente UTF-8 @param {string} hash sha256 hex
 * @returns {string}
 */
export function buildUpdateBegin(version, size, hash) {
  return `${UPDATE.BEGIN}:${String(version ?? "").trim()}:${size}:${String(hash ?? "").toLowerCase()}`;
}

/** @param {string} b64Chunk @returns {string} */
export function buildUpdateChunk(b64Chunk) {
  return `${UPDATE.CHUNK}:${b64Chunk}`;
}

/**
 * Parte el fuente del runtime en chunks base64 para UPDATE (chunk grande, ACK por bloque).
 * @param {string} code @param {number} [chunkBytes]
 * @returns {string[]}
 */
export function chunkRuntimeUpdate(code, chunkBytes = UPDATE_SOURCE_CHUNK) {
  return chunkProgram(code, chunkBytes > 0 ? chunkBytes : UPDATE_SOURCE_CHUNK);
}

/**
 * Parsea un frame UPDATE:* recibido del runtime (TX -> Web).
 * @param {string} raw
 * @returns {{ type:"info"|"ready"|"ack"|"verify_ok"|"applying"|"error"|"unknown", info?:object|null, index?:number, code?:string, raw:string }}
 */
export function parseUpdateFrame(raw) {
  const text = String(raw ?? "").trim();
  if (text === UPDATE.READY) return { type: "ready", raw: text };
  if (text === UPDATE.VERIFY_OK) return { type: "verify_ok", raw: text };
  if (text === UPDATE.APPLYING) return { type: "applying", raw: text };
  if (text.startsWith(UPDATE.INFO_PREFIX)) {
    return { type: "info", info: parseUpdateInfo(text), raw: text };
  }
  if (text.startsWith(UPDATE.ACK + ":")) {
    const n = parseInt(text.slice(UPDATE.ACK.length + 1), 10);
    return { type: "ack", index: Number.isFinite(n) ? n : -1, raw: text };
  }
  if (text.startsWith(UPDATE.ERROR + ":")) {
    return { type: "error", code: text.slice(UPDATE.ERROR.length + 1), raw: text };
  }
  return { type: "unknown", raw: text };
}

/**
 * Parsea la respuesta UPDATE:INFO:<json> a objeto. Devuelve null si no es valida.
 * @param {string} raw
 * @returns {null | {runtime:string, protocol:string, max:number, hash:boolean, state:string}}
 */
export function parseUpdateInfo(raw) {
  const text = String(raw ?? "").trim();
  const body = text.startsWith(UPDATE.INFO_PREFIX)
    ? text.slice(UPDATE.INFO_PREFIX.length)
    : text;
  if (!body.startsWith("{")) return null;
  try {
    const obj = JSON.parse(body);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
