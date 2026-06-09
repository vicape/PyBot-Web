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
 *   - "esp32-serial": EXPERIMENTAL (firmware JSON propio, src/esp32Session.js).
 *     No es default ni se ofrece en el selector; solo accesible seteando
 *     manualmente localStorage. No afecta a Arduino.
 *
 * Interfaz común de alto nivel (Arduino y JSON experimental):
 *   pinWrite(pin, value), pinRead(pin), pwmWrite(pin, value),
 *   servoWrite(pin, angle), motorWrite(pin, speed), close()
 */

import { connectFirmataSession, MODE_OUTPUT, MODE_PWM } from "./firmataSession.js";
import { connectEsp32Session } from "./esp32Session.js";
import { connectMicroPythonEsp32Session } from "./micropythonEsp32Session.js";

let _adapter = null;       // Arduino / JSON experimental (comandos por Pyodide)
let _mpSession = null;     // ESP32 MicroPython (ejecución en placa)
let _mode = null;          // "arduino-firmata" | "esp32-micropython" | "esp32-serial"
let _baudRate = null;

export function getBoardType() {
  try {
    const v = localStorage.getItem("pybot_board_type");
    if (v === "esp32-micropython") return "esp32-micropython";
    if (v === "esp32-serial") return "esp32-serial";
    return "arduino-firmata";
  } catch {
    return "arduino-firmata";
  }
}

/** Modo del hardware ACTUALMENTE conectado (no del seleccionado). */
export function hardwareMode() {
  return _mode;
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
export async function hardwareConnect() {
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
    const { session, close, baudRate } = await connectFirmataSession(port);
    _adapter = new ArduinoFirmataAdapter(session, close);
    _mode = "arduino-firmata";
    _baudRate = baudRate;
    return { baudRate, mode: _mode };
  } catch (e) {
    const msg = e?.message ?? String(e);
    throw new Error(`PYBOT_FIRMATA:${msg}`);
  }
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
 * Ejecuta el programa del alumno EN la placa (solo ESP32 MicroPython).
 * @param {string} code
 * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function}} cb
 */
export async function runOnBoard(code, cb = {}) {
  if (!_mpSession) throw new Error("not_connected");
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
