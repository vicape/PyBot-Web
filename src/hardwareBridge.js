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

let _adapter = null;       // Arduino / JSON experimental (comandos por Pyodide)
let _mpSession = null;     // ESP32 MicroPython / EDA6 (ejecución en placa)
let _mode = null;          // "arduino-firmata" | "esp32-micropython" | "esp32-eda6" | "esp32-serial"
let _baudRate = null;

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
  if (!_mpSession) throw new Error("not_connected");
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

/** Interrumpe (Ctrl-C) el programa en ejecución en la placa MicroPython. */
export async function interruptBoard() {
  if (_mpSession) {
    try {
      await _mpSession.interrupt();
    } catch {
      /* ignore */
    }
  }
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

/** Objeto registrado en Pyodide como `pybot_hw` */
export function createPyodideHwModule() {
  return {
    motor: (pin, speed) => hwMotor(pin, speed),
    servo_write: (pin, angle) => hwServoWrite(pin, angle),
    wait: (seconds) => hwWait(seconds),
    pin_read: (pinId) => hwPinRead(pinId),
    pin_write: (pinId, value) => hwPinWrite(pinId, value),
  };
}
