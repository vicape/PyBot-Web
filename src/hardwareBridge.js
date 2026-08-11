/**
 * Puente único Hardware ↔ Web.
 *
 * Backends según la placa (localStorage "pybot_board_type"):
 *   - "arduino-firmata" (POR DEFECTO): FirmataSession (StandardFirmata). El
 *     código del alumno corre en Pyodide y manda comandos por Firmata. Usa la
 *     interfaz común de alto nivel vía ArduinoFirmataAdapter. No modifica
 *     firmataSession.js.
 *   - "esp32-micropython": MicroPythonSession (src/micropythonEsp32Session.js).
 *     El programa del alumno corre NATIVAMENTE en la placa (REPL/raw REPL); no
 *     se usa Pyodide ni la interfaz de comandos. Ver runOnBoard().
 *   - "esp32-eda6": MicroPythonSession + perfil EDA6 (src/eda6Profile.js).
 *   - "esp32-serial": EXPERIMENTAL (firmware JSON propio, src/esp32Session.js).
 *     No es default ni se ofrece en el selector; solo accesible seteando
 *     manualmente localStorage. No afecta a Arduino.
 *
 * Interfaz común de alto nivel (Arduino y JSON experimental):
 *   pinWrite(pin, value), pinRead(pin), pwmWrite(pin, value),
 *   servoWrite(pin, angle), motorWrite(pin, speed), close()
 */

import { connectFirmataSession, MODE_OUTPUT, MODE_PWM } from "./firmataSession.js";
import { flashStandardFirmata } from "./arduinoFirmataFlash.js";
import { connectEsp32Session } from "./esp32Session.js";
import {
  connectMicroPythonEsp32Session,
  MPY_PRELUDE,
} from "./micropythonEsp32Session.js";
import {
  getEda6Profile,
  getEda6LibrarySource,
  getEda6ExecPrelude,
  prepareUserCodeForExec,
  prepareMainPyForFlash,
  detectPybotGpioUsage,
} from "./eda6Profile.js";
import {
  getPybotHwLibrarySource,
  prepareMainPyForGpioFlash,
  MAIN_PY_FILENAME,
  EDA6_FILENAME,
  PYBOT_HW_FILENAME,
} from "./esp32Flash.js";
import { compileToBytecode } from "./arduino/pybotArduinoCompiler.js";
import { downloadProgramToArduino } from "./arduinoVmSession.js";
import {
  getBleRuntimeSource,
  getBleBootSource,
  getBleRuntimeVersion,
  BLE_RUNTIME_FILENAME,
  BLE_BOOT_FILENAME,
} from "./pybotBleRuntime.js";
import {
  MEMORY_DIAGNOSTIC_SCRIPT,
  parseMemoryDiagnostic,
} from "./memoryDiagnostic.js";
import { BluetoothTransport } from "./bluetoothTransport.js";
import { BleRunSession } from "./bleRunSession.js";
import {
  BleDeploySession,
  runSavedApp,
  appInfo,
  appStop,
  appDelete,
  appAutostart,
} from "./bleDeploySession.js";
import {
  BleRuntimeUpdateSession,
  UPDATE_RECONNECT_TIMEOUT_MS,
} from "./bleRuntimeUpdateSession.js";
import {
  COMMANDS,
  RUN,
  parseInfoResponse,
  runtimeSupportsRun,
  runtimeSupportsDeploy,
  runtimeSupportsUpdate,
  runtimeUpdateStatus,
} from "./bleProtocol.js";

let _adapter = null;       // Arduino / JSON experimental (comandos por Pyodide)
let _mpSession = null;     // ESP32 MicroPython / EDA6 (ejecución en placa por SERIAL)
let _mode = null;          // "arduino-firmata" | "esp32-micropython" | "esp32-eda6" | "esp32-serial"
let _baudRate = null;

// Transporte de EJECUCION por BLE (independiente del serial). Cuando hay una
// ESP32 conectada por Bluetooth, el Run se ejecuta por aca en vez de por serial.
let _bleTransport = null;  // BluetoothTransport (Web Bluetooth)
let _bleRun = null;        // BleRunSession (RUN temporal, protocolo 3.0)
let _bleDeploy = null;     // BleDeploySession (DEPLOY persistente, protocolo 3.0)
let _bleUpdate = null;     // BleRuntimeUpdateSession (OTA del runtime, protocolo 3.1)

/** Nombre del archivo del preludio MPY (pin/servo/motor/wait) instalado en la placa. */
export const PYBOT_MPY_FILENAME = "pybot_mpy.py";

export function getBoardType() {
  try {
    const v = localStorage.getItem("pybot_board_type");
    if (v === "esp32-micropython") return "esp32-micropython";
    if (v === "esp32-eda6") return "esp32-eda6";
    if (v === "esp32-serial") return "esp32-serial";
    return "arduino-firmata";
  } catch {
    return "arduino-firmata";
  }
}

export { getEda6Profile };

/** Modo del hardware ACTUALMENTE conectado (no del seleccionado). */
export function hardwareMode() {
  return _mode;
}

export function isMicroPythonOnBoard() {
  return _mode === "esp32-micropython" || _mode === "esp32-eda6";
}

/** Prelude EDA6 para Run en vivo: siempre inyecta la librería con el perfil del menú.
 *  No depende de EDA6.py en la placa (evita archivos viejos / perfil incorrecto). */
function buildEda6RunPrelude(code, profile) {
  let prelude = getEda6ExecPrelude(profile);
  if (detectPybotGpioUsage(prepareUserCodeForExec(code))) {
    prelude = prelude + "\n" + MPY_PRELUDE;
  }
  return prelude;
}

/** Envuelve el código del alumno para que errores en placa aparezcan en consola. */
function wrapEda6UserCodeForRun(userCode) {
  const body = String(userCode ?? "").trimEnd();
  if (!body) return body;
  const indented = body
    .split("\n")
    .map((line) => "    " + line)
    .join("\n");
  return "try:\n" + indented + "\nexcept Exception as e:\n    import sys\n    sys.print_exception(e)\n";
}

/**
 * Adaptador de alto nivel para Arduino (StandardFirmata). Contiene la lógica
 * Arduino que antes vivía suelta en el bridge (mapeo A0–A5 → 14..19, decisión
 * PWM vs digital, lectura por caché). Mantiene el comportamiento idéntico.
 */
class ArduinoFirmataAdapter {
  constructor(session, closeFn) {
    this.session = session;
    this._closeFn = closeFn;
  }

  async pinWrite(pinId, value) {
    const s = this.session;
    const sid = typeof pinId === "string" ? pinId : String(pinId ?? "");
    let n;
    if (sid.toUpperCase().startsWith("A")) {
      const ch = parseInt(sid.slice(1), 10);
      if (Number.isNaN(ch) || ch < 0 || ch > 5) throw new Error("invalid_analog");
      n = 14 + ch;
    } else {
      n = parseInt(sid, 10);
    }
    if (Number.isNaN(n)) throw new Error("invalid_value");
    const v = parseInt(String(value), 10);
    if (Number.isNaN(v) || v < 0 || v > 255) throw new Error("invalid_value");
    if (v > 1) {
      await s.setPinMode(n, MODE_PWM);
      await s.pwmWrite(n, v);
    } else {
      await s.setPinMode(n, MODE_OUTPUT);
      await s.digitalWrite(n, v === 1);
    }
  }

  async pwmWrite(pinId, value) {
    const s = this.session;
    const n = parseInt(String(pinId), 10);
    if (Number.isNaN(n)) throw new Error("invalid_value");
    const v = Math.max(0, Math.min(255, parseInt(String(value), 10) || 0));
    await s.setPinMode(n, MODE_PWM);
    await s.pwmWrite(n, v);
  }

  async pinRead(pinId) {
    const s = this.session;
    const sid = typeof pinId === "string" ? pinId : String(pinId ?? "");
    if (sid.toUpperCase().startsWith("A")) {
      const ch = parseInt(sid.slice(1), 10);
      if (Number.isNaN(ch) || ch < 0 || ch > 5) {
        throw new Error("invalid_analog");
      }
      await new Promise((r) => setTimeout(r, 35));
      return s.readAnalogCached(ch);
    }
    const n = parseInt(sid, 10);
    await s.ensureDigitalIn(n);
    await new Promise((r) => setTimeout(r, 50));
    return s.readDigitalCached(n);
  }

  async servoWrite(pin, angle) {
    await this.session.servoWrite(pin, angle);
  }

  async motorWrite(pin, speed) {
    await this.session.motorWrite(pin, speed);
  }

  async close() {
    if (this._closeFn) await this._closeFn();
  }
}

export function hardwareIsConnected() {
  return _adapter != null || _mpSession != null;
}

export function hardwareBaudRate() {
  return _baudRate;
}

/** Códigos traducidos en i18n (formatHardwareError) */
/**
 * @param {{ onArduinoPrepare?: (info: { phase: string, pct?: number, status?: string }) => void }} [hooks]
 */
export async function hardwareConnect(hooks = {}) {
  if (!("serial" in navigator)) {
    throw new Error("PYBOT_USB:MISSING_BROWSER");
  }
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("PYBOT_USB:HTTPS");
  }

  await hardwareDisconnect();

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    const name = e?.name ?? "";
    if (name === "NotFoundError") {
      throw new Error("PYBOT_USB:LIST_EMPTY");
    }
    if (name === "SecurityError") {
      throw new Error("PYBOT_USB:PERMISSION");
    }
    throw e;
  }

  const boardType = getBoardType();

  if (boardType === "esp32-eda6") {
    try {
      const { session, baudRate } = await connectMicroPythonEsp32Session(port, {
        recoverRepl: true,
        mode: "esp32-eda6",
      });
      _mpSession = session;
      _mode = "esp32-eda6";
      _baudRate = baudRate;
      return { baudRate, mode: _mode };
    } catch (e) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
      const msg = e?.message ?? String(e);
      throw new Error(`PYBOT_MPY:${msg}`);
    }
  }

  if (boardType === "esp32-micropython") {
    try {
      const { session, baudRate } = await connectMicroPythonEsp32Session(port);
      _mpSession = session;
      _mode = "esp32-micropython";
      _baudRate = baudRate;
      return { baudRate, mode: _mode };
    } catch (e) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
      const msg = e?.message ?? String(e);
      throw new Error(`PYBOT_MPY:${msg}`);
    }
  }

  if (boardType === "esp32-serial") {
    // EXPERIMENTAL: firmware JSON propio. No es flujo principal.
    try {
      const { adapter, baudRate } = await connectEsp32Session(port);
      _adapter = adapter;
      _mode = "esp32-serial";
      _baudRate = baudRate;
      return { baudRate, mode: _mode };
    } catch (e) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
      const msg = e?.message ?? String(e);
      throw new Error(`PYBOT_ESP32:${msg}`);
    }
  }

  try {
    return await connectArduinoFirmata(port, hooks);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg.startsWith("PYBOT_FIRMATA:")) throw e;
    throw new Error(`PYBOT_FIRMATA:${msg}`);
  }
}

/**
 * @param {SerialPort} port
 * @param {{ onArduinoPrepare?: (info: { phase: string, pct?: number, status?: string }) => void }} [hooks]
 */
async function connectArduinoFirmata(port, hooks = {}) {
  try {
    const { session, close, baudRate } = await connectFirmataSession(port);
    _adapter = new ArduinoFirmataAdapter(session, close);
    _mode = "arduino-firmata";
    _baudRate = baudRate;
    return { baudRate, mode: _mode, firmataPrepared: false };
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg !== "NO_FIRMATA") {
      throw new Error(`PYBOT_FIRMATA:${msg}`);
    }
  }

  hooks.onArduinoPrepare?.({ phase: "start" });
  try {
    await flashStandardFirmata(port, {
      onProgress: ({ pct, status }) => {
        hooks.onArduinoPrepare?.({ phase: "progress", pct, status });
      },
    });
    hooks.onArduinoPrepare?.({ phase: "done" });
  } catch {
    hooks.onArduinoPrepare?.({ phase: "fail" });
    throw new Error("PYBOT_FIRMATA:FLASH_FAIL");
  }

  const { session, close, baudRate } = await connectFirmataSession(port);
  _adapter = new ArduinoFirmataAdapter(session, close);
  _mode = "arduino-firmata";
  _baudRate = baudRate;
  return { baudRate, mode: _mode, firmataPrepared: true };
}

export async function hardwareDisconnect() {
  if (_adapter) {
    try {
      await _adapter.close();
    } catch {
      /* ignore */
    }
  }
  if (_mpSession) {
    try {
      await _mpSession.close();
    } catch {
      /* ignore */
    }
  }
  _adapter = null;
  _mpSession = null;
  _mode = null;
  _baudRate = null;
}

/**
 * Ejecuta el programa del alumno EN la placa (ESP32 MicroPython / EDA6).
 * @param {string} code
 * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function}} cb
 */
export async function runOnBoard(code, cb = {}) {
  // Adaptador de transporte: si hay una sesion SERIAL activa, se usa el camino
  // serial EXACTAMENTE como hasta hoy. Si no, y hay una ESP32 por BLE, se ejecuta
  // por Bluetooth. El serial tiene prioridad para no alterar su comportamiento.
  if (_mpSession) {
    // Detener main.py o un while True previo antes de subir el nuevo programa.
    try {
      await _mpSession.interruptAndRecoverRepl();
    } catch {
      /* ignore */
    }
    if (_mode === "esp32-eda6") {
      const profile = getEda6Profile();
      const body = prepareUserCodeForExec(code);
      const probe =
        'print("EDA6", PLACA_ACTUAL, "salida 1 -> GPIO", _pins()["digital_outputs"][0])\n';
      const userCode = probe + "detenerTodo()\n" + wrapEda6UserCodeForRun(body);
      const prelude = buildEda6RunPrelude(code, profile);
      return _mpSession.runProgram(userCode, { ...cb, prelude });
    }
    return _mpSession.runProgram(code, cb);
  }
  if (_bleRun && _bleRun.isConnected()) {
    return runOnBoardBle(code, cb);
  }
  throw new Error("not_connected");
}

/**
 * Ejecuta el programa del alumno por BLE. El preludio (mpy/eda6) vive en la placa
 * como archivos .py; aca solo enviamos el codigo + modo + perfil.
 */
async function runOnBoardBle(code, cb = {}) {
  const boardType = getBoardType();
  const mode = boardType === "esp32-eda6" ? "eda6" : "mpy";
  const profile = getEda6Profile();
  // Diagnostico: la placa DEBE tener el runtime nuevo (protocolo RUN 2.0). Con el
  // MVP viejo (FW 1.x) los frames RUN:* se ignoran y el Run muere por timeout;
  // detectarlo aca da un error claro y guia a reinstalar por USB.
  await ensureBleRuntimeSupportsRun();
  // El firmware hace `from EDA6 import *`; el import del alumno es redundante e
  // inofensivo. Enviamos el codigo tal cual (sin el wrap/prelude serial). La
  // libreria EDA6/pybot_mpy NO viaja por BLE: vive en la placa (instalada por USB).
  const userCode = mode === "eda6" ? prepareUserCodeForExec(code) : String(code ?? "");
  return _bleRun.runProgram(userCode, { ...cb, mode, profile });
}

/**
 * Verifica (via INFO) que la ESP32 conectada por BLE tenga el runtime con soporte
 * RUN. Usa el INFO cacheado del transporte si existe; si no, hace una consulta
 * corta. Lanza BLE_RUNTIME_OUTDATED si confirma un runtime viejo. Si INFO no
 * responde, no bloquea (deja que el timeout de RUN sea el fallback).
 */
async function ensureBleRuntimeSupportsRun() {
  if (!_bleTransport) return;
  let info = _bleTransport.getDeviceInfo?.().info ?? null;
  if (!info) {
    try {
      const raw = await _bleTransport.sendAndWait(COMMANDS.INFO, 3000);
      info = parseInfoResponse(raw);
      if (info) _bleTransport.setDeviceInfo?.(info);
    } catch {
      info = null; // INFO no respondio: no bloquear, RUN maneja el timeout.
    }
  }
  if (info && !runtimeSupportsRun(info)) {
    throw new Error("BLE_RUNTIME_OUTDATED");
  }
}

/**
 * Obtiene el INFO del runtime BLE (cacheado o consultado). Puede devolver null
 * si la placa no responde INFO (no bloquea).
 */
async function getBleInfo() {
  if (!_bleTransport) return null;
  let info = _bleTransport.getDeviceInfo?.().info ?? null;
  if (!info) {
    try {
      const raw = await _bleTransport.sendAndWait(COMMANDS.INFO, 3000);
      info = parseInfoResponse(raw);
      if (info) _bleTransport.setDeviceInfo?.(info);
    } catch {
      info = null;
    }
  }
  return info;
}

/** @returns {boolean} true si hay una ESP32 por BLE lista para EJECUTAR (RUN). */
export function bleRunReady() {
  return !!_bleRun && _bleRun.isConnected();
}

/**
 * Indica si el runtime BLE conectado soporta DEPLOY persistente. Prefiere las
 * capabilities declaradas por INFO. @returns {Promise<boolean>}
 */
export async function bleSupportsDeploy() {
  if (!_bleTransport || !_bleTransport.isConnected()) return false;
  const info = await getBleInfo();
  return runtimeSupportsDeploy(info);
}

/**
 * "Bajar a ESP32" por BLE (DEPLOY persistente): transfiere y guarda el programa
 * verificado (size+hash), habilita autostart y lo ejecuta. La placa lo corre
 * sin PC/navegador/BLE/Internet y sobrevive power cycle.
 *
 * @param {string} code
 * @param {{ onProgress?: Function }} [hooks]
 * @returns {Promise<{ mode:string, profile:string, size:number, hash:string }>}
 */
export async function bleDeployProgram(code, hooks = {}) {
  if (!_bleDeploy || !_bleDeploy.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const supported = await bleSupportsDeploy();
  if (!supported) throw new Error("BLE_DEPLOY_UNSUPPORTED");

  const boardType = getBoardType();
  const mode = boardType === "esp32-eda6" ? "eda6" : "mpy";
  const profile = getEda6Profile();
  // Igual que el RUN por BLE: la libreria EDA6/pybot_mpy vive en la placa; solo
  // se transfiere el codigo del alumno (con el import EDA6 redundante removido).
  const userCode = mode === "eda6" ? prepareUserCodeForExec(code) : String(code ?? "");

  // Redeploy con app corriendo (P0-7): detener la ejecucion actual ANTES del
  // DEPLOY para no chocar con DEPLOY:ERROR:BUSY. Cooperativo (cubre los programas
  // con wait()); si la app no cede, el DEPLOY reportara BUSY y la UI lo informa.
  await stopBleExecutionBeforeDeploy();

  const result = await _bleDeploy.deploy(userCode, {
    mode,
    profile,
    onProgress: hooks.onProgress,
  });
  // El firmware ya deja autostart=True tras un DEPLOY exitoso; lo reafirmamos por
  // claridad (idempotente) para el caso "Bajar = guardar + verificar + autostart".
  try {
    await appAutostart(_bleTransport, true);
  } catch {
    /* metadata ya quedo con autostart=true en el commit del firmware */
  }
  return result;
}

/** Ejecuta la app persistente ya guardada y transmite su salida a la consola. */
export async function bleRunSavedApp(cb = {}) {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  return runSavedApp(_bleTransport, cb);
}

/** Consulta el estado de la app persistente en la placa (por BLE). */
export async function bleGetAppInfo() {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  return appInfo(_bleTransport);
}

/** Detiene la app persistente en ejecucion (por BLE). */
export async function bleStopApp() {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  return appStop(_bleTransport);
}

/** Borra la app persistente y su metadata (NO el runtime/EDA6/pybot_mpy). */
export async function bleDeleteApp() {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  return appDelete(_bleTransport);
}

/** Habilita/deshabilita el autostart de la app persistente (por BLE). */
export async function bleSetAutostart(on) {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  return appAutostart(_bleTransport, !!on);
}

// ===========================================================================
// Actualización OTA del runtime por BLE (protocolo 3.1). Canal ADMINISTRATIVO:
// no se expone ninguna función educativa (no hay updateRuntime() para el alumno).
// ===========================================================================

/**
 * Indica si el runtime BLE conectado soporta la actualización OTA (capability
 * "runtime-update"). Una placa 3.0.x NO la declara → necesita una última
 * instalación por USB para habilitar el OTA. @returns {Promise<boolean>}
 */
export async function bleSupportsUpdate() {
  if (!_bleTransport || !_bleTransport.isConnected()) return false;
  const info = await getBleInfo();
  return runtimeSupportsUpdate(info);
}

/**
 * Estado de actualización del runtime: compara la versión INSTALADA (INFO) con la
 * versión PUBLICADA por esta versión de PyBot Web (fuente de verdad única). La UI
 * decide en base a esto (detección automática; instalación NO silenciosa).
 * @returns {Promise<{ installed:string|null, latest:string, updateAvailable:boolean,
 *   supportsOta:boolean, canUpdateOta:boolean, needsUsb:boolean }>}
 */
export async function bleRuntimeUpdateInfo() {
  if (!_bleTransport || !_bleTransport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const info = await getBleInfo();
  return runtimeUpdateStatus(info, getBleRuntimeVersion());
}

/**
 * Actualiza el runtime de la ESP32 por BLE (OTA), de forma segura y verificada:
 *   1) Estado seguro: detiene RUN temporal / APP en curso (cooperativo).
 *   2) Transfiere el runtime nuevo a pybot_runtime.new, verifica size + SHA-256.
 *   3) UPDATE:APPLY → la placa escribe el estado pendiente y RESETEA; boot.py hace
 *      el swap transaccional (backup + rollback) en el arranque.
 *   4) Reconecta automáticamente al MISMO dispositivo (sin chooser), lee INFO y
 *      verifica que la versión instalada == destino.
 *
 * NO declara éxito solo por VERIFY: recién con reconnect + INFO con firmware ==
 * target se considera verificado. Si la reconexión automática no es posible (no es
 * corrupción), devuelve reconnected=false para que el usuario reconecte a mano.
 *
 * @param {{ onProgress?: (info:{phase:string, pct?:number, sent?:number, total?:number}) => void }} [hooks]
 * @returns {Promise<{ ok:true, applied:boolean, reconnected:boolean, verified:boolean, target:string, installed:string|null }>}
 */
export async function bleUpdateRuntime(hooks = {}) {
  if (!_bleUpdate || !_bleUpdate.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const onProgress = hooks.onProgress ?? (() => {});

  // 0) Confirmar (por capability) que la placa expone el canal OTA. Una placa
  //    3.0.x sin "runtime-update" requiere una última actualización por USB.
  const status = await bleRuntimeUpdateInfo();
  if (!status.supportsOta) throw new Error("BLE_UPDATE_UNSUPPORTED");

  // 1) Estado seguro: detener RUN temporal / APP corriendo (cooperativo). El
  //    firmware además rechaza con UPDATE:ERROR:BUSY si algo sigue en ejecución.
  await stopBleExecutionBeforeDeploy();

  const source = getBleRuntimeSource();
  const version = getBleRuntimeVersion();

  // 2-3) Transferir + verificar + aplicar. Al aplicar, la placa RESETEA (BLE cae).
  await _bleUpdate.update(source, { version, onProgress });

  // 4) Reconectar al MISMO device (sin volver a mostrar el selector del navegador).
  onProgress({ phase: "reconnecting", pct: 100 });
  let reconnected = false;
  try {
    await _bleTransport.reconnect(UPDATE_RECONNECT_TIMEOUT_MS);
    reconnected = true;
  } catch {
    reconnected = false;
  }

  if (!reconnected) {
    // La actualización se aplicó; solo no pudimos reconectar automáticamente
    // (posible limitación de Web Bluetooth). NO es corrupción.
    onProgress({ phase: "applied-no-reconnect", pct: 100 });
    return {
      ok: true,
      applied: true,
      reconnected: false,
      verified: false,
      target: version,
      installed: null,
    };
  }

  // Reconectado: leer INFO y verificar la versión instalada == destino.
  onProgress({ phase: "verifying-version", pct: 100 });
  const info = await getBleInfo();
  const installed = info && info.firmware ? String(info.firmware) : null;
  const verified = installed === version;
  onProgress({ phase: verified ? "done" : "version-mismatch", pct: 100 });
  return {
    ok: true,
    applied: true,
    reconnected: true,
    verified,
    target: version,
    installed,
  };
}

/**
 * Operación UNIFICADA de STOP del programa en la placa (P0-5 / P1-4). Una sola
 * abstracción para todos los transportes, con el ESP32 como fuente de verdad:
 *   1) SERIAL (_mpSession) → Ctrl-C existente (prioridad serial intacta).
 *   2) BLE, RUN temporal (sesión web) → STOP cooperativo con escalado a FORCE.
 *   3) BLE, app persistente corriendo (aunque haya arrancado por autostart, sin
 *      sesión web) → APP:STOP y, si no cede, escalado a STOP:FORCE (reset).
 * @returns {Promise<{transport:string, kind?:string}>}
 */
export async function stopBoardExecution() {
  if (_mpSession) {
    try {
      await _mpSession.interrupt();
    } catch {
      /* ignore */
    }
    return { transport: "serial" };
  }
  if (_bleTransport && _bleTransport.isConnected()) {
    // RUN temporal gestionado por la sesión web (BleRunSession sabe escalar a FORCE).
    if (_bleRun && _bleRun.isRunning && _bleRun.isRunning()) {
      try {
        await _bleRun.stop();
      } catch {
        /* ignore */
      }
      return { transport: "ble", kind: "run" };
    }
    // El ESP32 es la fuente de verdad: consultar si hay una app persistente
    // corriendo (puede haber arrancado antes de que exista la sesión web).
    let info = null;
    try {
      info = await appInfo(_bleTransport);
    } catch {
      info = null;
    }
    if (info && info.running) {
      try {
        // APP:OK:STOP significa "detenida de verdad" (confirmación real).
        await appStop(_bleTransport);
      } catch {
        // No cooperativo / timeout → escalado a STOP:FORCE (reset + safe boot).
        try {
          await _bleTransport.send(RUN.STOP_FORCE);
        } catch {
          /* ignore */
        }
      }
      return { transport: "ble", kind: "app" };
    }
    // Sin evidencia de ejecución: STOP cooperativo best-effort.
    if (_bleRun) {
      try {
        await _bleRun.stop();
      } catch {
        /* ignore */
      }
    }
    return { transport: "ble", kind: "none" };
  }
  return { transport: "none" };
}

/** @deprecated Alias histórico de {@link stopBoardExecution} (misma semántica unificada). */
export async function interruptBoard() {
  await stopBoardExecution();
}

/**
 * Detiene cualquier ejecución BLE ANTES de un DEPLOY para no chocar con
 * DEPLOY:ERROR:BUSY (redeploy con app corriendo, P0-7). Cooperativo: NO escala a
 * STOP:FORCE porque el reset caería el BLE y abortaría el propio DEPLOY. Si la app
 * no cede, el DEPLOY responde BUSY y la UI lo informa.
 */
async function stopBleExecutionBeforeDeploy() {
  if (_bleRun && _bleRun.isRunning && _bleRun.isRunning()) {
    try {
      await _bleRun.stop();
    } catch {
      /* ignore */
    }
  }
  try {
    const info = await appInfo(_bleTransport);
    if (info && info.running) {
      try {
        await appStop(_bleTransport);
      } catch {
        /* timeout / no cooperativo: el DEPLOY reportará BUSY */
      }
    }
  } catch {
    /* INFO no responde: el DEPLOY reportará BUSY si sigue corriendo */
  }
}

// ===========================================================================
// Conexion de EJECUCION por BLE (Web Bluetooth). Encapsulada: no toca el serial.
// ===========================================================================

/**
 * Conecta una ESP32 por BLE para EJECUTAR programas (Run inalámbrico).
 * Devuelve el nombre del dispositivo. Reutiliza BluetoothTransport.
 * @returns {Promise<{ deviceName: string|null }>}
 */
export async function bleRunConnect() {
  if (_bleTransport && _bleTransport.isConnected()) {
    return { deviceName: _bleTransport.getDeviceInfo?.().deviceName ?? null };
  }
  const tr = new BluetoothTransport();
  const info = await tr.connect();
  _bleTransport = tr;
  _bleRun = new BleRunSession(tr);
  _bleDeploy = new BleDeploySession(tr);
  _bleUpdate = new BleRuntimeUpdateSession(tr);
  return info;
}

/** @returns {boolean} true si hay una ESP32 conectada por BLE para ejecucion. */
export function bleRunIsConnected() {
  return !!_bleRun && _bleRun.isConnected();
}

/** Devuelve el BluetoothTransport activo (para diagnostico PING/INFO/LED) o null. */
export function bleRunTransport() {
  return _bleTransport;
}

/** Desconecta la ESP32 BLE de ejecucion (no afecta el serial). */
export async function bleRunDisconnect() {
  if (_bleTransport) {
    try {
      await _bleTransport.disconnect();
    } catch {
      /* ignore */
    }
  }
  _bleTransport = null;
  _bleRun = null;
  _bleDeploy = null;
  _bleUpdate = null;
}

async function clearMpSessionAfterReset() {
  if (_mpSession) {
    try {
      await _mpSession.close();
    } catch {
      /* puerto ya cerrado por el reset */
    }
  }
  _mpSession = null;
  _mode = null;
  _baudRate = null;
}

export async function checkEda6Installed() {
  if (!_mpSession) throw new Error("not_connected");
  return _mpSession.fileExists(EDA6_FILENAME);
}

export async function checkMainPyInstalled() {
  if (!_mpSession) throw new Error("not_connected");
  return _mpSession.fileExists(MAIN_PY_FILENAME);
}

export async function installEda6Library(profile = getEda6Profile()) {
  if (!_mpSession) throw new Error("not_connected");
  const source = getEda6LibrarySource(profile);
  await _mpSession.installFile(EDA6_FILENAME, source);
}

async function flashAndReset(verifyEda6) {
  const verify = await _mpSession.verifyMainPyOnBoard(verifyEda6);
  if (!verify.ok) {
    throw new Error(`FLASH_VERIFY_FAIL:${verify.detail || "unknown"}`);
  }
  if (verify.mainSize < 8) {
    throw new Error("FLASH_VERIFY_FAIL:main_too_small");
  }
  await _mpSession.softReset();
  await clearMpSessionAfterReset();
  return verify;
}

/** Graba EDA6.py + main.py y reinicia la placa para ejecución autónoma. */
export async function flashProgramToBoard(code, profile = getEda6Profile()) {
  if (!_mpSession) throw new Error("not_connected");
  await _mpSession.interruptAndRecoverRepl();
  await installEda6Library(profile);
  const mainPy = prepareMainPyForFlash(code);
  await _mpSession.installFile(MAIN_PY_FILENAME, mainPy);
  return flashAndReset(true);
}

/** Graba pybot_hw.py + main.py (GPIO directo) y reinicia la placa. */
export async function flashGpioProgramToBoard(code) {
  if (!_mpSession) throw new Error("not_connected");
  await _mpSession.interruptAndRecoverRepl();
  await _mpSession.installFile(PYBOT_HW_FILENAME, getPybotHwLibrarySource());
  await _mpSession.installFile(MAIN_PY_FILENAME, prepareMainPyForGpioFlash(code));
  return flashAndReset(false);
}

/**
 * Instala el PyBot BLE Runtime (MicroPython) en la placa ESP32 conectada por USB.
 * REUTILIZA la transferencia por raw REPL (installFile), igual que EDA6: escribe
 * el runtime como main.py, verifica y reinicia (softReset) para que arranque solo.
 * No inventa esptool/offsets; requiere una ESP32 con MicroPython ya presente.
 *
 * @param {{ onProgress?: (info: { phase: string, done?: number, total?: number, pct?: number }) => void }} [hooks]
 * @returns {Promise<{ size: number }>}
 */
export async function installBleRuntime(hooks = {}) {
  if (!_mpSession) throw new Error("not_connected");
  if (_mode !== "esp32-micropython" && _mode !== "esp32-eda6") {
    throw new Error("not_esp32");
  }
  const onProgress = hooks.onProgress;
  onProgress?.({ phase: "start" });
  await _mpSession.interruptAndRecoverRepl();

  // 1) Preludios en la placa: pin/servo/motor/wait (mpy) y librería EDA6.
  //    Así por BLE solo viaja el código del alumno + modo/perfil (no la librería).
  //    Se reutiliza el MISMO texto fuente que el flujo serial (única fuente).
  onProgress?.({ phase: "installing-libs" });
  await _mpSession.installFile(PYBOT_MPY_FILENAME, MPY_PRELUDE);
  await _mpSession.installFile(EDA6_FILENAME, getEda6LibrarySource(getEda6Profile()));

  // 2) boot.py: el update/rollback manager estable. MicroPython lo ejecuta ANTES
  //    de main.py y HABILITA las futuras actualizaciones OTA por Bluetooth (esta
  //    es la última instalación por USB necesaria para el OTA). NO borra
  //    pybot_app.py/pybot_app.json si existen (son del alumno, archivos distintos).
  onProgress?.({ phase: "installing-boot" });
  await _mpSession.installFile(BLE_BOOT_FILENAME, getBleBootSource());

  // 3) Runtime BLE como main.py (arranca solo al boot).
  const source = getBleRuntimeSource();
  onProgress?.({ phase: "installing", done: 0, total: 100, pct: 0 });
  await _mpSession.installFile(BLE_RUNTIME_FILENAME, source, {
    onProgress: (info) => onProgress?.({ phase: "installing", ...info }),
  });

  onProgress?.({ phase: "verifying" });
  const bootExists = await _mpSession.fileExists(BLE_BOOT_FILENAME);
  const bootSize = bootExists ? await _mpSession.getFileSize(BLE_BOOT_FILENAME) : -1;
  if (!bootExists || bootSize < 8) {
    throw new Error("BLE_INSTALL_VERIFY_FAIL");
  }
  const exists = await _mpSession.fileExists(BLE_RUNTIME_FILENAME);
  const size = exists ? await _mpSession.getFileSize(BLE_RUNTIME_FILENAME) : -1;
  if (!exists || size < 8) {
    throw new Error("BLE_INSTALL_VERIFY_FAIL");
  }

  onProgress?.({ phase: "resetting" });
  await _mpSession.softReset();
  await clearMpSessionAfterReset();
  onProgress?.({ phase: "done", size });
  return { size };
}

/**
 * Diagnóstico de memoria por USB (SOLO lectura) sobre la sesión serial ya
 * conectada. Reutiliza el raw REPL (execRaw): interrumpe cualquier main.py
 * colgado, ejecuta un script MicroPython corto (MEMFREE/MAINSIZE/COMPILE/BLE)
 * y devuelve un objeto estructurado. NO borra archivos ni reinicia la placa.
 *
 * Sirve para confirmar si la ESP32 se queda sin memoria al preparar/compilar el
 * runtime (main.py) o al activar BLE, lo que explicaría que no advertise tras un
 * reset (no aparece en el chooser de Web Bluetooth).
 *
 * @returns {Promise<ReturnType<typeof parseMemoryDiagnostic> & { raw: string }>}
 */
export async function runMemoryDiagnostic() {
  if (!_mpSession) throw new Error("not_connected");
  if (_mode !== "esp32-micropython" && _mode !== "esp32-eda6") {
    throw new Error("not_esp32");
  }
  // Interrumpe main.py u otro programa colgado antes de entrar a raw REPL.
  try {
    await _mpSession.interruptAndRecoverRepl();
  } catch {
    /* ignore */
  }
  // execRaw entra a raw REPL (Ctrl-C Ctrl-C + Ctrl-A), ejecuta y sale con Ctrl-B.
  const { stdout, stderr } = await _mpSession.execRaw(MEMORY_DIAGNOSTIC_SCRIPT, {
    timeout: 25000,
  });
  const text = String(stdout ?? "") + "\n" + String(stderr ?? "");
  const parsed = parseMemoryDiagnostic(text);
  return { ...parsed, raw: text };
}

/** Detiene main.py en la placa y deja el REPL listo (sin desconectar). */
export async function recoverEsp32Repl() {
  if (!_mpSession) throw new Error("not_connected");
  await _mpSession.interruptAndRecoverRepl();
}

/**
 * Graba el programa en la ESP32 para que corra solo al desconectar PyBot.
 * @returns {"eda6"|"gpio"}
 */
export async function flashToEsp32(code) {
  if (_mode === "esp32-eda6") {
    const verify = await flashProgramToBoard(code, getEda6Profile());
    return { kind: "eda6", verify };
  }
  if (_mode === "esp32-micropython") {
    const verify = await flashGpioProgramToBoard(code);
    return { kind: "gpio", verify };
  }
  throw new Error("not_esp32");
}

export async function deleteMainPy() {
  if (!_mpSession) throw new Error("not_connected");
  return _mpSession.removeFile(MAIN_PY_FILENAME);
}

/**
 * "Bajar a Arduino": compila el programa del alumno a bytecode y lo graba en la
 * placa (firmware VM) para que corra SOLA, desconectada de la PC. No usa Firmata
 * ni Pyodide. Desconecta cualquier sesión en vivo para liberar el puerto.
 *
 * @param {string} code código Python del alumno
 * @param {{ onPhase?: (phase: "compiling"|"uploading"|"flashing"|"retry") => void }} [hooks]
 * @returns {Promise<{ flashed: boolean, bytes: number }>}
 */
export async function downloadToArduino(code, hooks = {}) {
  if (!("serial" in navigator)) {
    throw new Error("PYBOT_USB:MISSING_BROWSER");
  }
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("PYBOT_USB:HTTPS");
  }

  hooks.onPhase?.("compiling");
  const compiled = compileToBytecode(code);
  if (!compiled.ok) {
    const e = new Error("PYBOT_DL:COMPILE");
    e.compile = compiled.error; // { line, es, en }
    throw e;
  }

  await hardwareDisconnect();

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    const name = e?.name ?? "";
    if (name === "NotFoundError") throw new Error("PYBOT_USB:LIST_EMPTY");
    if (name === "SecurityError") throw new Error("PYBOT_USB:PERMISSION");
    throw e;
  }

  try {
    const { flashed } = await downloadProgramToArduino(port, compiled.image, {
      onPhase: (phase) => hooks.onPhase?.(phase),
    });
    return { flashed, bytes: compiled.image.length };
  } finally {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }
}

function needAdapter() {
  if (!_adapter) throw new Error("not_connected");
  return _adapter;
}

export async function hwMotor(pin, speed) {
  await needAdapter().motorWrite(pin, speed);
}

export async function hwServoWrite(pin, angle) {
  await needAdapter().servoWrite(pin, angle);
}

export async function hwWait(seconds) {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || ms < 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (globalThis.__PYBOT_STOP__) {
      throw new Error("Programa detenido.");
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function hwPinRead(pinId) {
  return needAdapter().pinRead(pinId);
}

export async function hwPinWrite(pinId, value) {
  await needAdapter().pinWrite(pinId, value);
}
