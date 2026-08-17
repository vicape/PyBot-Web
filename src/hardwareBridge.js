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
  connectMicroPythonFromTransport,
  MPY_PRELUDE,
} from "./micropythonEsp32Session.js";
import { BLE_NATIVE_PRELUDE, BLE_LINK_STATE } from "./micropython/constants.js";
import { PROTOCOL_ERROR, errorCode } from "./micropython/errors.js";
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
  getBleRuntimeVersion,
  getBleRuntimeInstallFiles,
  buildBleRuntimePackText,
  getPybotNetSource,
  BLE_RUNTIME_FILENAME,
  BLE_BOOT_FILENAME,
} from "./pybotBleRuntime.js";
import {
  MEMORY_DIAGNOSTIC_SCRIPT,
  parseMemoryDiagnostic,
} from "./memoryDiagnostic.js";
import { BluetoothTransport } from "./bluetoothTransport.js";
import { BleRunSession, setBleForceStopLog } from "./bleRunSession.js";
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
  APP,
  parseInfoResponse,
  parseCapabilities,
  runtimeSupportsRun,
  runtimeSupportsDeploy,
  runtimeSupportsUpdate,
  runtimeUpdateStatus,
  runtimeStopReliable,
  compareRuntimeVersions,
  PYBOT_STOP_RELIABLE_MIN,
} from "./bleProtocol.js";
import { isNativeBleEnabled } from "./micropython/featureFlags.js";
import { BleReplTransport } from "./micropython/bleReplTransport.js";
import { STOP_LEVEL } from "./micropython/stopLifecycle.js";
import {
  BLE_BACKEND,
  classifyBleRuntime,
  finalizeBleBackend,
  formatBleBackendDiagnosis,
} from "./micropython/bleBackend.js";
import { runEsp32Provisioning } from "./esp32/provisionEsp32.js";
import { inspectPybotOnSession } from "./esp32/boardProbe.js";
import { expectedProvisionFiles } from "./esp32/pybotInstallManifest.js";
import { loadOfficialFirmware } from "./esp32/firmwareLoader.js";
import {
  connectBootloader,
  eraseFlash,
  writeFirmware,
  resetAndRelease,
  ensurePortClosed,
} from "./esp32/esp32Flasher.js";
import { BOARD_STATE, PROVISION_ERROR } from "./esp32/provisioningPhases.js";

const BLE_STOP_WAIT_MS = 3500;
const BLE_FORCE_WAIT_MS = 2500;
/** Tras RUN:STOPPED cooperativo, no mandar STOP:FORCE por path APP (ACK perdido). */
const BLE_COOP_STOP_GRACE_MS = 20000;

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let _adapter = null;       // Arduino / JSON experimental (comandos por Pyodide)
let _mpSession = null;     // ESP32 MicroPython / EDA6 (ejecución en placa por SERIAL)
let _mode = null;          // "arduino-firmata" | "esp32-micropython" | "esp32-eda6" | "esp32-serial"
let _baudRate = null;

// Transporte de EJECUCION por BLE (independiente del serial). Cuando hay una
// ESP32 conectada por Bluetooth, el Run se ejecuta por aca en vez de por serial.
let _bleTransport = null;  // BluetoothTransport (Web Bluetooth)
let _bleRun = null;        // LEGACY BleRunSession: SOLO modo legado explícito / runtime < 4.0
let _bleMpSession = null;  // MicroPythonSession sobre BLE REPL (camino nativo 4.0)
let _bleDeploy = null;     // BleDeploySession (DEPLOY persistente, protocolo 3.0)
let _bleUpdate = null;     // BleRuntimeUpdateSession (OTA del runtime, protocolo 3.1)
/** Diagnóstico técnico del backend de ejecución BLE (nunca fallback silencioso). */
let _bleBackendDiag = null;
/** Serializa stopBoardExecution (Stop doble / carrera con Run). */
let _bleStopInFlight = null;
/**
 * Generacion monotona: sube al iniciar un Run BLE (antes del handshake INFO).
 * stopBoardExecution la usa para NO mandar STOP:FORCE si ya arranco otro Run.
 */
let _bleRunPrepGen = 0;
/** Epoch ms del ultimo RUN:STOPPED cooperativo (temp run o ACK). */
let _bleLastCoopStoppedAt = 0;
/** Logger UI para STOP:FORCE (appendConsole). */
let _bleForceUiLog = null;

/** Registra logger visible: "STOP:FORCE enviado (razón: …)". */
export function setBleForceLog(fn) {
  _bleForceUiLog = typeof fn === "function" ? fn : null;
  setBleForceStopLog(_bleForceUiLog);
}

function noteBleCoopStopped() {
  _bleLastCoopStoppedAt = Date.now();
}

function recentlyCoopStopped() {
  return (
    _bleLastCoopStoppedAt > 0 &&
    Date.now() - _bleLastCoopStoppedAt < BLE_COOP_STOP_GRACE_MS
  );
}

function logBleForce(reason) {
  const msg = "STOP:FORCE enviado (razón: " + String(reason ?? "desconocida") + ")";
  try {
    _bleForceUiLog?.(msg);
  } catch {
    /* ignore */
  }
}

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
      return { baudRate, mode: _mode, ...(await pybotStateSnapshot()) };
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
      return { baudRate, mode: _mode, ...(await pybotStateSnapshot()) };
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

function provisionMode() {
  return getBoardType() === "esp32-eda6" ? "esp32-eda6" : "esp32-micropython";
}

async function pybotStateSnapshot() {
  if (!_mpSession) return {};
  try {
    const inspection = await inspectPybotOnSession(_mpSession);
    return {
      pybotState: inspection.boardState,
      pybotFiles: inspection.files,
      pybotRuntime: inspection.runtimeVersion,
    };
  } catch {
    return {};
  }
}

async function requestSerialPort() {
  if (!("serial" in navigator)) {
    throw new Error("PYBOT_USB:MISSING_BROWSER");
  }
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("PYBOT_USB:HTTPS");
  }
  try {
    return await navigator.serial.requestPort();
  } catch (e) {
    const name = e?.name ?? "";
    if (name === "NotFoundError") {
      const err = new Error(PROVISION_ERROR.PORT_CANCELLED);
      err.code = PROVISION_ERROR.PORT_CANCELLED;
      err.name = "NotFoundError";
      throw err;
    }
    if (name === "SecurityError") {
      const err = new Error(PROVISION_ERROR.PORT_PERMISSION);
      err.code = PROVISION_ERROR.PORT_PERMISSION;
      err.name = "SecurityError";
      throw err;
    }
    throw e;
  }
}

/**
 * Flujo Preparar ESP32 (Chrome/Edge + Web Serial).
 * Capa A: ROM bootloader + firmware oficial MicroPython.
 * Capa B: raw REPL + installBleRuntime (mismos archivos que USB BLE).
 *
 * @param {{
 *   onPhase?: Function,
 *   onLog?: Function,
 *   signal?: { aborted?: boolean },
 *   forceReinstall?: boolean,
 *   confirmFlash?: () => Promise<boolean>,
 *   confirmInstall?: () => Promise<boolean>,
 *   confirmUpdate?: () => Promise<boolean>,
 *   confirmReinstall?: () => Promise<boolean>,
 * }} [hooks]
 */
export async function prepareEsp32(hooks = {}) {
  await hardwareDisconnect();
  const mode = provisionMode();

  const adapters = {
    requestPort: requestSerialPort,
    async probeBoard(port) {
      try {
        const { session, baudRate } = await connectMicroPythonEsp32Session(port, {
          recoverRepl: true,
          mode,
        });
        _mpSession = session;
        _mode = mode;
        _baudRate = baudRate;
        const inspection = await inspectPybotOnSession(session);
        return { ...inspection, session };
      } catch (e) {
        const msg = e?.message ?? String(e);
        const code = e?.code ?? msg;
        if (msg === "BUSY" || code === "BUSY" || code === PROVISION_ERROR.BUSY) {
          const err = new Error(PROVISION_ERROR.BUSY);
          err.code = PROVISION_ERROR.BUSY;
          throw err;
        }
        if (
          msg === "NEEDS_PREP" ||
          code === PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT ||
          code === PROTOCOL_ERROR.BLE_REPL_HANDSHAKE_FAIL
        ) {
          return { boardState: BOARD_STATE.REPL_UNAVAILABLE, session: null };
        }
        return { boardState: BOARD_STATE.UNKNOWN, session: null, error: String(code) };
      }
    },
    connectBootloader: (port) =>
      connectBootloader(port, { onLog: hooks.onLog }),
    eraseFlash,
    writeFirmware,
    resetAndRelease,
    loadFirmware: () => loadOfficialFirmware(),
    async connectRepl(port, opts = {}) {
      if (opts.afterFlash) await sleepMs(2200);
      if (opts.afterInstall) await sleepMs(1200);
      const { session, baudRate } = await connectMicroPythonEsp32Session(port, {
        recoverRepl: true,
        mode,
      });
      _mpSession = session;
      _mode = mode;
      _baudRate = baudRate;
      return { session, baudRate };
    },
    async installPybot(opts) {
      return installBleRuntime(opts);
    },
    async verifyPybotFiles() {
      if (!_mpSession) return { ok: false, missing: expectedProvisionFiles() };
      const missing = [];
      for (const name of expectedProvisionFiles()) {
        try {
          const exists = await _mpSession.fileExists(name);
          const size = exists ? await _mpSession.getFileSize(name) : -1;
          if (!exists || size < 8) missing.push(name);
        } catch {
          missing.push(name);
        }
      }
      return { ok: missing.length === 0, missing };
    },
    async closePort(port, session) {
      if (session) {
        try {
          await session.close();
        } catch {
          /* ignore */
        }
      }
      if (_mpSession && (session == null || _mpSession === session)) {
        _mpSession = null;
        _mode = null;
        _baudRate = null;
      }
      await ensurePortClosed(port);
    },
    sleep: sleepMs,
  };

  return runEsp32Provisioning(adapters, hooks);
}

export { BOARD_STATE, PROVISION_ERROR };

/**
 * Ejecuta el programa del alumno EN la placa (ESP32 MicroPython / EDA6).
 * @param {string} code
 * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function}} cb
 */
export async function runOnBoard(code, cb = {}) {
  // Serial USB tiene prioridad absoluta sobre BLE.
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
  if (isNativeBleEnabled() && _bleMpSession) {
    try {
      await _bleMpSession.interruptAndRecoverRepl();
    } catch {
      /* ignore */
    }
    if (getBoardType() === "esp32-eda6") {
      const body = prepareUserCodeForExec(code);
      const probe =
        'print("EDA6", PLACA_ACTUAL, "salida 1 -> GPIO", _pins()["digital_outputs"][0])\n';
      const userCode = probe + wrapEda6UserCodeForRun(body);
      const prelude = BLE_NATIVE_PRELUDE + "from EDA6 import *\n";
      return _bleMpSession.runProgram(userCode, { ...cb, prelude });
    }
    return _bleMpSession.runProgram(code, { ...cb, prelude: BLE_NATIVE_PRELUDE });
  }
  if (_bleRun && _bleRun.isConnected()) {
    return runOnBoardBle(code, cb);
  }
  if (_bleTransport && _bleTransport.isConnected()) {
    const detail =
      _bleBackendDiag?.error ||
      _bleBackendDiag?.reason ||
      "no-native-session";
    throw new Error("BLE_NATIVE_REPL_FAIL:" + detail);
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
  // Marcar "Run en curso" ANTES del INFO: un stopBoardExecution que espera ACK
  // no debe escalar a STOP:FORCE mientras arranca el siguiente programa.
  _bleRunPrepGen += 1;
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
      const raw = await _bleTransport.sendAndWait(COMMANDS.INFO, 3000, {
        match: (msg) => String(msg ?? "").trim().startsWith("{"),
      });
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
      const raw = await _bleTransport.sendAndWait(COMMANDS.INFO, 3000, {
        match: (msg) => String(msg ?? "").trim().startsWith("{"),
      });
      info = parseInfoResponse(raw);
      if (info) _bleTransport.setDeviceInfo?.(info);
    } catch {
      info = null;
    }
  }
  return info;
}

/** @returns {boolean} true si hay una ESP32 por BLE lista para EJECUTAR. */
export function bleRunReady() {
  if (isNativeBleEnabled() && _bleMpSession) return true;
  return !!_bleRun && _bleRun.isConnected();
}

/** Diagnóstico técnico del backend BLE activo (o del fallo, sin fallback). */
export function getBleBackendDiagnosis() {
  return _bleBackendDiag;
}

export { formatBleBackendDiagnosis, BLE_BACKEND };

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
  try {
    return await appDelete(_bleTransport);
  } catch {
    // App no cooperativa: APP:DELETE (urgente) deja ack=delete; FORCE borra
    // antes del reset (firmware 3.2.4+) y apaga autostart + safe_boot.
    try {
      await _bleTransport.send(APP.DELETE);
    } catch {
      /* ignore */
    }
    try {
      logBleForce("app-delete-fallback");
      await _bleTransport.send(RUN.STOP_FORCE);
    } catch {
      /* ignore */
    }
    return { ok: true, forced: true };
  }
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

  // Progreso visible de inmediato (0%) antes de INFO / stop / transferencia.
  onProgress({ phase: "start", pct: 0, sent: 0, total: 0 });

  // 0) Confirmar (por capability) que la placa expone el canal OTA. Una placa
  //    3.0.x sin "runtime-update" requiere una última actualización por USB.
  const status = await bleRuntimeUpdateInfo();
  if (!status.supportsOta) throw new Error("BLE_UPDATE_UNSUPPORTED");

  // 1) Estado seguro: detener RUN temporal / APP corriendo (cooperativo). El
  //    firmware además rechaza con UPDATE:ERROR:BUSY si algo sigue en ejecución.
  await stopBleExecutionBeforeDeploy();

  // Pack multi-archivo (PYBOTRT1): boot.py 3.2+ lo descomprime en los módulos.
  // Placas < 3.2.0 deben actualizar por USB (runtimeUpdateStatus.needsUsb).
  const source = buildBleRuntimePackText();
  const version = getBleRuntimeVersion();

  // 2-3) Transferir + verificar + aplicar. Al aplicar, la placa RESETEA (BLE cae).
  await _bleUpdate.update(source, { version, onProgress });

  // 4) Reconectar al MISMO device (sin volver a mostrar el selector del navegador).
  onProgress({ phase: "reconnecting", pct: 100 });
  let reconnected = false;
  try {
    await _bleTransport.reconnect(UPDATE_RECONNECT_TIMEOUT_MS);
    reconnected = true;
    await activateBleExecutionBackend(_bleTransport);
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
 * Escucha confirmación de stop BLE (RUN:STOPPED / APP:OK:STOP) o desconexión.
 * El caller debe registrar esto ANTES de enviar los comandos (evita perder ACK).
 * @returns {{ done: () => boolean, stop: () => void }}
 */
function armBleStopAck() {
  const tr = _bleTransport;
  let settled = !tr || !tr.isConnected();
  const mark = () => {
    settled = true;
  };
  let offData = null;
  let offState = null;
  if (tr) {
    offData = tr.onData((msg) => {
      const t = String(msg ?? "");
      if (
        t.includes("RUN:STOPPED") ||
        t.includes("APP:OK:STOP") ||
        t.includes("APP:OK:DELETE") ||
        t.includes("RUN:DONE")
      ) {
        if (t.includes("RUN:STOPPED") || t.includes("APP:OK:STOP")) {
          noteBleCoopStopped();
        }
        mark();
      }
    });
    if (typeof tr.onStateChange === "function") {
      offState = tr.onStateChange((state) => {
        if (state === "disconnected" || state === "idle") mark();
      });
    }
  }
  return {
    done: () => settled || !_bleTransport || !_bleTransport.isConnected(),
    stop: () => {
      if (offData) offData();
      if (offState) offState();
    },
  };
}

async function waitArmedBleStopAck(armed, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  try {
    while (!armed.done() && Date.now() < deadline) {
      await sleepMs(50);
    }
    return armed.done();
  } finally {
    armed.stop();
  }
}

/**
 * Operación UNIFICADA de STOP del programa en la placa (P0-5 / P1-4). Una sola
 * abstracción para todos los transportes, con el ESP32 como fuente de verdad:
 *   1) SERIAL (_mpSession) → Ctrl-C existente (prioridad serial intacta).
 *   2) BLE, RUN temporal (sesión web) → STOP cooperativo con escalado a FORCE.
 *   3) BLE sin sesión RUN local (app persistente / autostart / unknown) →
 *      APP:STOP + STOP, y si no cede, STOP:FORCE. No depende de APP:INFO.
 * @returns {Promise<{transport:string, kind?:string}>}
 */
export async function stopBoardExecution() {
  if (_mpSession) {
    try {
      await _mpSession.interrupt({ level: STOP_LEVEL.CTRL_C });
    } catch {
      /* ignore */
    }
    return { transport: "serial" };
  }
  if (isNativeBleEnabled() && _bleMpSession) {
    try {
      await _bleMpSession.interrupt({ level: STOP_LEVEL.CTRL_C });
    } catch {
      /* ignore */
    }
    return { transport: "ble-native" };
  }
  // Runtime nativo esperado: no hay sesión REPL. NO escalar a STOP:FORCE.
  if (isNativeBleEnabled() && !_bleRun) {
    return { transport: "ble-native", kind: "no-session" };
  }
  if (_bleTransport && _bleTransport.isConnected()) {
    // Coalescer Stop concurrentes (doble click / Stop idle tras TEMP RUN).
    // Sin esto, el 2º Stop toma el path APP, pierde el ACK ya emitido y escala
    // a STOP:FORCE durante el siguiente Run → GATT disconnect.
    if (_bleStopInFlight) {
      try {
        await _bleStopInFlight;
      } catch {
        /* ignore */
      }
      return { transport: "ble", kind: "coalesced" };
    }
    let releaseStopLock = () => {};
    _bleStopInFlight = new Promise((resolve) => {
      releaseStopLock = resolve;
    });
    try {
      // RUN temporal gestionado por la sesión web (BleRunSession escala a FORCE
      // SOLO si isRunning y no llega STOPPED).
      if (_bleRun && _bleRun.isRunning && _bleRun.isRunning()) {
        try {
          await _bleRun.stop({ wait: true });
        } catch {
          /* ignore */
        }
        try {
          _bleRun.disarmForceEscalate?.();
        } catch {
          /* ignore */
        }
        noteBleCoopStopped();
        // Regla de oro: tras stop cooperativo de run temporal, NUNCA caer al
        // path APP:STOP+FORCE (perderia el ACK ya emitido → reset GATT).
        return { transport: "ble", kind: "run" };
      }
      // Stop idle justo despues de un RUN:STOPPED: no reenviar APP/FORCE.
      if (recentlyCoopStopped()) {
        return { transport: "ble", kind: "app-recent-coop" };
      }
      // App persistente / autostart / programa en placa sin `running` local en la UI.
      const prepGenAtStop = _bleRunPrepGen;
      const armed = armBleStopAck();
      try {
        await _bleTransport.send(APP.STOP);
      } catch {
        /* ignore */
      }
      try {
        await _bleTransport.send(RUN.STOP);
      } catch {
        /* ignore */
      }
      if (await waitArmedBleStopAck(armed, BLE_STOP_WAIT_MS)) {
        noteBleCoopStopped();
        return { transport: "ble", kind: "app" };
      }
      // Un nuevo Run BLE arranco mientras esperabamos ACK: NUNCA FORCE
      // (mataria el GATT del programa que el alumno acaba de lanzar).
      if (
        prepGenAtStop !== _bleRunPrepGen ||
        (_bleRun && _bleRun.isRunning && _bleRun.isRunning()) ||
        recentlyCoopStopped()
      ) {
        return { transport: "ble", kind: "app-superseded" };
      }
      // ACK perdido pero la placa responde PING → esta idle, no bloqueada en
      // exec. FORCE resetearia GATT y romperia Run→Stop→Run.
      try {
        await _bleTransport.sendAndWait("PING", 600, {
          match: (m) => /PONG/i.test(String(m ?? "")),
        });
        return { transport: "ble", kind: "app-idle" };
      } catch {
        /* sin PONG: exec bloqueado o enlace caido → FORCE */
      }
      if (
        prepGenAtStop !== _bleRunPrepGen ||
        (_bleRun && _bleRun.isRunning && _bleRun.isRunning()) ||
        recentlyCoopStopped()
      ) {
        return { transport: "ble", kind: "app-superseded" };
      }
      // No cooperativo → FORCE (Timer en firmware 3.2.4+). Solo si NUNCA hubo
      // STOPPED reciente para este ciclo (regla de oro 3.2.7).
      logBleForce("app-stop-sin-ACK");
      const armedForce = armBleStopAck();
      try {
        await _bleTransport.send(RUN.STOP_FORCE);
      } catch {
        /* ignore */
      }
      await waitArmedBleStopAck(armedForce, BLE_FORCE_WAIT_MS);
      return { transport: "ble", kind: "app-force" };
    } finally {
      releaseStopLock();
      _bleStopInFlight = null;
    }
  }
  return { transport: "none" };
}

/**
 * INFO del runtime BLE + si el Stop es fiable (>= 3.2.4). Para avisos de aula.
 * @returns {Promise<{ info: object|null, stopReliable: boolean, installed: string|null }>}
 */
export async function bleRuntimeStopStatus() {
  const info = await getBleInfo();
  const installed = info && info.firmware != null ? String(info.firmware) : null;
  return {
    info,
    stopReliable: runtimeStopReliable(info),
    installed,
    minReliable: PYBOT_STOP_RELIABLE_MIN,
    outdated:
      installed != null &&
      compareRuntimeVersions(installed, PYBOT_STOP_RELIABLE_MIN) < 0,
  };
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
 * Activa el backend de ejecución BLE. 4.0.0 + native-repl → SOLO MicroPythonSession.
 * Si el handshake nativo falla, NO se crea BleRunSession.
 */
async function activateBleExecutionBackend(tr) {
  _bleRun = null;
  if (_bleMpSession) {
    try {
      await _bleMpSession.close();
    } catch {
      /* ignore */
    }
    _bleMpSession = null;
  }

  const info = await getBleInfo();
  const replStatus =
    typeof tr.getReplStatus === "function"
      ? tr.getReplStatus()
      : {
          rx: !!tr.hasRepl?.(),
          tx: !!tr.hasRepl?.(),
          notifications: !!tr.hasRepl?.(),
          bindError: null,
        };
  const hasReplChars = !!(replStatus.rx && replStatus.tx);
  const classified = classifyBleRuntime({
    nativeFlagEnabled: isNativeBleEnabled(),
    info,
    hasReplChars,
  });

  const baseDiag = {
    runtime: info?.firmware ?? null,
    protocol: info?.protocol ?? null,
    nativeReplCap: parseCapabilities(info).includes("native-repl"),
    replRx: !!replStatus.rx,
    replTx: !!replStatus.tx,
    notifications: !!replStatus.notifications,
    dupterm: info?.dupterm === true,
    handshake: false,
    backend: null,
    error: null,
    reason: classified.reason ?? null,
    bindError: replStatus.bindError ?? null,
    gatt: true,
    link: hasReplChars && replStatus.notifications !== false
      ? BLE_LINK_STATE.REPL_TRANSPORT_READY
      : BLE_LINK_STATE.GATT_CONNECTED,
  };

  const apply = (extra) => {
    _bleBackendDiag = { ...baseDiag, ...extra };
    try {
      console.info(formatBleBackendDiagnosis(_bleBackendDiag));
    } catch {
      /* ignore */
    }
    return _bleBackendDiag;
  };

  if (classified.intent === "legacy") {
    _bleRun = new BleRunSession(tr, {
      onCoopStopped: () => noteBleCoopStopped(),
    });
    return apply({
      backend: BLE_BACKEND.LEGACY_RUN,
      reason: classified.reason,
    });
  }

  const decided = finalizeBleBackend({
    ...classified,
    hasReplChars,
    notifications: replStatus.notifications !== false,
    handshakeOk: false,
  });
  if (classified.intent !== "native") {
    return apply({
      backend: null,
      error: decided.error || classified.error || "BLE_REPL_UNVERIFIED",
    });
  }
  if (!hasReplChars) {
    return apply({
      backend: null,
      error: "BLE_REPL_CHARS_MISSING",
    });
  }
  if (replStatus.notifications === false) {
    return apply({
      backend: null,
      error: "BLE_REPL_NOTIFY_FAIL",
    });
  }

  try {
    const bleTr = new BleReplTransport(tr);
    const { session } = await connectMicroPythonFromTransport(bleTr, {
      detect: true,
      recoverRepl: true,
    });
    _bleMpSession = session;
    _bleRun = null;
    return apply({
      handshake: true,
      backend: BLE_BACKEND.NATIVE_REPL,
      error: null,
      link: BLE_LINK_STATE.RAW_REPL_READY,
    });
  } catch (e) {
    _bleMpSession = null;
    _bleRun = null;
    return apply({
      handshake: false,
      backend: null,
      error: String(e?.code ?? e?.message ?? e ?? "BLE_REPL_HANDSHAKE_FAIL"),
      link: BLE_LINK_STATE.REPL_TRANSPORT_READY,
    });
  }
}

/**
 * Conecta una ESP32 por BLE para EJECUTAR programas (Run inalámbrico).
 * Devuelve el nombre del dispositivo. Reutiliza BluetoothTransport.
 * @returns {Promise<{ deviceName: string|null }>}
 */
export async function bleRunConnect() {
  if (_bleTransport && _bleTransport.isConnected()) {
    if (isNativeBleEnabled() && !_bleMpSession) {
      await activateBleExecutionBackend(_bleTransport);
    }
    return { deviceName: _bleTransport.getDeviceInfo?.().deviceName ?? null };
  }
  const tr = new BluetoothTransport();
  const info = await tr.connect();
  _bleTransport = tr;
  _bleDeploy = new BleDeploySession(tr);
  _bleUpdate = new BleRuntimeUpdateSession(tr);
  await activateBleExecutionBackend(tr);
  return info;
}

/** @returns {boolean} true si hay una ESP32 conectada por BLE (GATT). */
export function bleRunIsConnected() {
  return !!_bleTransport && _bleTransport.isConnected();
}

/** Devuelve el BluetoothTransport activo (para diagnostico PING/INFO/LED) o null. */
export function bleRunTransport() {
  return _bleTransport;
}

/** Desconecta la ESP32 BLE de ejecucion (no afecta el serial). */
export async function bleRunDisconnect() {
  if (_bleMpSession) {
    try {
      await _bleMpSession.close();
    } catch {
      /* ignore */
    }
  }
  _bleMpSession = null;
  if (_bleTransport) {
    try {
      await _bleTransport.disconnect();
    } catch {
      /* ignore */
    }
  }
  _bleTransport = null;
  _bleRun = null;
  _bleMpSession = null;
  _bleDeploy = null;
  _bleUpdate = null;
  _bleBackendDiag = null;
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
  try {
    await _mpSession.installFile("pybot_net.py", getPybotNetSource());
  } catch {
    /* ignore */
  }
  const mainPy = prepareMainPyForFlash(code);
  await _mpSession.installFile(MAIN_PY_FILENAME, mainPy);
  return flashAndReset(true);
}

/** Graba pybot_hw.py + main.py (GPIO directo) y reinicia la placa. */
export async function flashGpioProgramToBoard(code) {
  if (!_mpSession) throw new Error("not_connected");
  await _mpSession.interruptAndRecoverRepl();
  await _mpSession.installFile(PYBOT_HW_FILENAME, getPybotHwLibrarySource());
  try {
    await _mpSession.installFile("pybot_net.py", getPybotNetSource());
  } catch {
    /* ignore */
  }
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

  // EDA6.py no viaja en el pack OTA; se instala una vez por USB.
  // pybot_mpy.py y pybot_net.py salen SOLO de getBleRuntimeInstallFiles().
  onProgress?.({ phase: "installing-libs" });
  await _mpSession.installFile(EDA6_FILENAME, getEda6LibrarySource(getEda6Profile()));

  // Runtime 4.0.0: boot.py + main.py + módulos (ble/repl/mpy/net/run/deploy/update).
  const files = getBleRuntimeInstallFiles();
  const totalBytes = files.reduce((n, f) => n + String(f.source ?? "").length, 0);
  let doneBytes = 0;
  onProgress?.({ phase: "installing", done: 0, total: totalBytes, pct: 0 });

  for (const file of files) {
    const phase =
      file.name === BLE_BOOT_FILENAME
        ? "installing-boot"
        : file.name === BLE_RUNTIME_FILENAME
          ? "installing"
          : "installing-modules";
    onProgress?.({ phase, done: doneBytes, total: totalBytes, pct: totalBytes ? Math.floor((100 * doneBytes) / totalBytes) : 0 });
    await _mpSession.installFile(file.name, file.source, {
      onProgress: (info) => {
        const localDone = info?.done ?? 0;
        const overall = doneBytes + localDone;
        onProgress?.({
          phase,
          done: overall,
          total: totalBytes,
          pct: totalBytes ? Math.min(100, Math.floor((100 * overall) / totalBytes)) : 0,
        });
      },
    });
    doneBytes += String(file.source ?? "").length;
  }

  onProgress?.({ phase: "verifying", done: totalBytes, total: totalBytes, pct: 100 });
  for (const file of files) {
    const exists = await _mpSession.fileExists(file.name);
    const size = exists ? await _mpSession.getFileSize(file.name) : -1;
    if (!exists || size < 8) {
      throw new Error("BLE_INSTALL_VERIFY_FAIL");
    }
  }

  onProgress?.({ phase: "resetting" });
  await _mpSession.softReset();
  await clearMpSessionAfterReset();
  onProgress?.({ phase: "done", size: totalBytes });
  return { size: totalBytes };
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

/** Archivos de la app persistente BLE (alumno). El runtime NO se toca. */
const PERSISTENT_APP_FILES = [
  "pybot_app.py",
  "pybot_app.json",
  "pybot_app.tmp",
  "pybot_app.bak",
  "pybot_app.json.tmp",
  "pybot_app.json.bak",
];

/**
 * Recuperación USB: borra la app persistente (pybot_app.*) y resetea el estado
 * de safe_boot/autostart sin destruir el runtime BLE. Para placas zombie donde
 * BLE no responde o "Instalar PyBot Bluetooth" no alcanza (preserva la app).
 *
 * @param {{ onProgress?: (info: { phase: string }) => void, reset?: boolean }} [hooks]
 * @returns {Promise<{ removed: string[], reset: boolean }>}
 */
export async function clearPersistentAppUsb(hooks = {}) {
  if (!_mpSession) throw new Error("not_connected");
  if (_mode !== "esp32-micropython" && _mode !== "esp32-eda6") {
    throw new Error("not_esp32");
  }
  const onProgress = hooks.onProgress;
  const doReset = hooks.reset !== false;
  onProgress?.({ phase: "interrupt" });
  await _mpSession.interruptAndRecoverRepl();

  onProgress?.({ phase: "removing" });
  const removed = [];
  for (const name of PERSISTENT_APP_FILES) {
    try {
      const ok = await _mpSession.removeFile(name);
      if (ok) removed.push(name);
    } catch {
      /* ignore individual remove failures; verify below */
    }
  }

  // Estado limpio: sin safe_boot ni contador de fallos (evita bloqueos residuales).
  try {
    await _mpSession.installFile(
      "pybot_state.json",
      JSON.stringify({
        safe_boot: false,
        fail_count: 0,
        last_error: "",
        last_outcome: "cleared",
      }),
    );
  } catch {
    /* best-effort */
  }

  // Verificar que la app principal ya no está.
  try {
    const still = await _mpSession.fileExists("pybot_app.py");
    if (still) throw new Error("BLE_CLEAR_APP_FAILED");
  } catch (e) {
    if (e?.message === "BLE_CLEAR_APP_FAILED") throw e;
  }

  if (doReset) {
    onProgress?.({ phase: "resetting" });
    await _mpSession.softReset();
    await clearMpSessionAfterReset();
  }
  onProgress?.({ phase: "done" });
  return { removed, reset: doReset };
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
