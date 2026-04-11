/**
 * Puente único Arduino ↔ Web: sesión Firmata activa o null.
 */

import { connectFirmataSession, MODE_OUTPUT, MODE_PWM } from "./firmataSession.js";

let _session = null;
let _close = null;
let _baudRate = null;

export function hardwareIsConnected() {
  return _session != null;
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

  try {
    const { session, close, baudRate } = await connectFirmataSession(port);
    _session = session;
    _close = close;
    _baudRate = baudRate;
    return { baudRate };
  } catch (e) {
    const msg = e?.message ?? String(e);
    throw new Error(`PYBOT_FIRMATA:${msg}`);
  }
}

export async function hardwareDisconnect() {
  if (_close) {
    try {
      await _close();
    } catch {
      /* ignore */
    }
  }
  _session = null;
  _close = null;
  _baudRate = null;
}

function needSession() {
  if (!_session) throw new Error("not_connected");
  return _session;
}

export async function hwMotor(pin, speed) {
  await needSession().motorWrite(pin, speed);
}

export async function hwServoWrite(pin, angle) {
  await needSession().servoWrite(pin, angle);
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
  const s = needSession();
  const sid =
    typeof pinId === "string" ? pinId : String(pinId ?? "");
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

export async function hwPinWrite(pinId, value) {
  const s = needSession();
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
