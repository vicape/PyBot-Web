/**
 * Fuente del PyBot BLE Runtime (MicroPython) para instalar en la placa.
 *
 * Runtime 4.0.0: layout modular. Al boot solo se cargan `boot.py` (mínimo) +
 * `main.py` (stub) + `pybot_ble.py` (núcleo BLE/PING/INFO). RUN/DEPLOY/APP/UPDATE
 * viven en módulos aparte con import perezoso. El OTA envía un pack multi-archivo
 * (`PYBOTRT1`) que `pybot_boot_update.apply()` instala de forma transaccional.
 */

import bleRuntimeRaw from "../firmware/pybot-ble-runtime/main.py?raw";
import bleBootRaw from "../firmware/pybot-ble-runtime/boot.py?raw";
import bleCoreRaw from "../firmware/pybot-ble-runtime/pybot_ble.py?raw";
import bleRunRaw from "../firmware/pybot-ble-runtime/pybot_run.py?raw";
import bleDeployRaw from "../firmware/pybot-ble-runtime/pybot_deploy.py?raw";
import bleUpdateRaw from "../firmware/pybot-ble-runtime/pybot_update.py?raw";
import bleBootUpdateRaw from "../firmware/pybot-ble-runtime/pybot_boot_update.py?raw";
import bleReplRaw from "../firmware/pybot-ble-runtime/pybot_repl.py?raw";
import bleNetRaw from "../firmware/pybot-ble-runtime/pybot_net.py?raw";
import bleMpyRaw from "../firmware/pybot-ble-runtime/pybot_mpy.py?raw";
import { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION, sha256Hex } from "./bleProtocol.js";

/** Se instala como main.py (stub que importa el núcleo). */
export const BLE_RUNTIME_FILENAME = "main.py";

/**
 * Se instala como boot.py: MicroPython lo ejecuta ANTES de main.py. En 4.0.0 es
 * un chequeo mínimo; el apply/rollback vive en pybot_boot_update.py (lazy).
 */
export const BLE_BOOT_FILENAME = "boot.py";

/** Magic del pack OTA multi-archivo (debe coincidir con pybot_boot_update.py). */
export const BLE_RUNTIME_PACK_MAGIC = "PYBOTRT1\n";

/**
 * Archivos del runtime que viajan en el pack OTA / instalación USB (además de
 * boot.py, que se instala por USB y se mantiene estable).
 */
export const BLE_RUNTIME_MODULE_FILES = Object.freeze([
  "main.py",
  "pybot_ble.py",
  "pybot_run.py",
  "pybot_deploy.py",
  "pybot_update.py",
  "pybot_boot_update.py",
  "pybot_repl.py",
  "pybot_net.py",
  "pybot_mpy.py",
]);

/** Archivos que MicroPython carga en el camino crítico de advertising. */
export const BLE_BOOT_CORE_FILES = Object.freeze(["boot.py", "main.py", "pybot_ble.py"]);

export { PYBOT_RUNTIME_VERSION, PYBOT_PROTOCOL_VERSION };

/**
 * Version del runtime PUBLICADA por esta version de PyBot Web (fuente de verdad
 * unica; el mismo texto que declara el firmware por INFO).
 */
export function getBleRuntimeVersion() {
  return PYBOT_RUNTIME_VERSION;
}

export function getPybotNetSource() {
  return bleNetRaw;
}

export function getPybotMpyBoardSource() {
  return bleMpyRaw;
}

/** Texto del stub main.py. */
export function getBleRuntimeSource() {
  return bleRuntimeRaw;
}

/** Texto del boot mínimo. */
export function getBleBootSource() {
  return bleBootRaw;
}

/**
 * Módulos del runtime (nombre en placa + fuente) en orden de instalación.
 * Incluye main.py; NO incluye boot.py (se instala aparte y no va en el pack OTA
 * para no reescribir el boot en ejecución).
 */
export function getBleRuntimeModules() {
  return [
    { name: "main.py", source: bleRuntimeRaw },
    { name: "pybot_ble.py", source: bleCoreRaw },
    { name: "pybot_run.py", source: bleRunRaw },
    { name: "pybot_deploy.py", source: bleDeployRaw },
    { name: "pybot_update.py", source: bleUpdateRaw },
    { name: "pybot_boot_update.py", source: bleBootUpdateRaw },
    { name: "pybot_repl.py", source: bleReplRaw },
    { name: "pybot_net.py", source: bleNetRaw },
    { name: "pybot_mpy.py", source: bleMpyRaw },
  ];
}

/**
 * Archivos a instalar por USB: boot.py + módulos del runtime.
 * @returns {{ name: string, source: string }[]}
 */
export function getBleRuntimeInstallFiles() {
  return [{ name: BLE_BOOT_FILENAME, source: bleBootRaw }, ...getBleRuntimeModules()];
}

/**
 * Construye el pack binario OTA (`PYBOTRT1`) como Uint8Array.
 * Formato por archivo: name\\n + size\\n + bytes.
 */
export function buildBleRuntimePackBytes() {
  const enc = new TextEncoder();
  const chunks = [enc.encode(BLE_RUNTIME_PACK_MAGIC)];
  for (const { name, source } of getBleRuntimeModules()) {
    const data = enc.encode(String(source ?? ""));
    chunks.push(enc.encode(name + "\n"));
    chunks.push(enc.encode(String(data.length) + "\n"));
    chunks.push(data);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Pack OTA como string latin1 (1 byte = 1 char) para reutilizar el canal UPDATE
 * que hace TextEncoder sobre el payload. Solo válido si el pack es ASCII-safe;
 * los .py del runtime lo son. Preferí `buildBleRuntimePackBytes` + sesión binaria.
 */
export function buildBleRuntimePackText() {
  const bytes = buildBleRuntimePackBytes();
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** SHA-256 hex del pack OTA (bytes exactos que viajan a la placa). */
export function getBleRuntimePackHash() {
  return sha256Hex(buildBleRuntimePackBytes());
}

/**
 * Tamaños del runtime (bytes de fuente UTF-8). Útil para tests/umbral de boot.
 * @returns {{ bootCore: number, totalInstalled: number, files: Record<string, number> }}
 */
export function getBleRuntimeSizeStats() {
  const enc = new TextEncoder();
  const files = {};
  let totalInstalled = 0;
  let bootCore = 0;
  for (const { name, source } of getBleRuntimeInstallFiles()) {
    const n = enc.encode(String(source ?? "")).length;
    files[name] = n;
    totalInstalled += n;
    if (BLE_BOOT_CORE_FILES.includes(name)) bootCore += n;
  }
  return { bootCore, totalInstalled, files };
}
