/**
 * Sesión Firmata (StandardFirmata Arduino Uno/Nano-like) para Web Serial.
 * Digital in/out, PWM vía extended analog, servo/motor, lectura analógica A0–A5.
 */

import {
  PIN_MODE,
  REPORT_VERSION,
  START_SYSEX,
  END_SYSEX,
  EXTENDED_ANALOG,
  MODE_SERVO,
  buildSetPinMode,
  buildExtendedAnalog,
  buildServoFromSpeed,
  speedToServoAngle,
} from "./firmataWeb.js";

export const MODE_INPUT = 0;
export const MODE_OUTPUT = 1;
export const MODE_PWM = 3;
export { MODE_SERVO };

const REPORT_ANALOG = 0xc0;
const REPORT_DIGITAL = 0xd0;

function portForPin(pin) {
  return pin < 8 ? 0 : 1;
}

function bitForPin(pin) {
  return pin < 8 ? pin : pin - 8;
}

export class FirmataSession {
  /**
   * @param {WritableStreamDefaultWriter} writer
   * @param {ReadableStreamDefaultReader} reader
   */
  constructor(writer, reader) {
    this.writer = writer;
    this.reader = reader;
    /** @type {number[]} máscara de salida por puerto 0 y 1 */
    this._outMask = [0, 0];
    /** @type {number[]} última lectura digital por puerto */
    this._inMask = [0, 0];
    /** @type {Record<number, number>} canal analógico 0–5 → 0–1023 */
    this._analog = {};
    this._parseBuf = [];
    this._sysex = false;
    this._expect = null;
    this._running = true;
    this._parsePromise = this._parseLoop();
    /** pines en modo SERVO (para motor stop release) */
    this._servoPins = new Set();
  }

  async _parseLoop() {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done || !this._running) break;
        if (!value?.length) continue;
        for (let i = 0; i < value.length; i++) {
          this._pushByte(value[i]);
        }
      }
    } catch {
      /* cancel */
    }
  }

  _pushByte(b) {
    if (this._expect) {
      this._expect.bytes.push(b);
      if (this._expect.bytes.length >= this._expect.need) {
        const { type, port, pin, bytes } = this._expect;
        this._expect = null;
        if (type === "dig") {
          const mask = bytes[0] | (bytes[1] << 7);
          this._inMask[port] = mask & 0x3fff;
        } else if (type === "an") {
          const raw = bytes[0] | (bytes[1] << 7);
          this._analog[pin] = Math.min(1023, raw & 0x3ff);
        }
      }
      return;
    }

    if (this._sysex) {
      if (b === END_SYSEX) {
        this._sysex = false;
        this._parseBuf = [];
      } else {
        this._parseBuf.push(b);
      }
      return;
    }

    if (b === START_SYSEX) {
      this._sysex = true;
      this._parseBuf = [];
      return;
    }

    if (b >= 0x90 && b <= 0x9f) {
      const port = b & 0x0f;
      this._expect = { type: "dig", port, need: 2, bytes: [] };
      return;
    }

    if (b >= 0xe0 && b <= 0xef) {
      const pin = b & 0x0f;
      this._expect = { type: "an", pin, need: 2, bytes: [] };
    }
  }

  async init() {
    await new Promise((r) => setTimeout(r, 2200));
    await this.writer.write(new Uint8Array([REPORT_VERSION]));
    await new Promise((r) => setTimeout(r, 400));
    for (let p = 0; p <= 1; p++) {
      await this.writer.write(new Uint8Array([REPORT_DIGITAL | p, 1]));
    }
    for (let a = 0; a < 6; a++) {
      await this.writer.write(new Uint8Array([REPORT_ANALOG | a, 1]));
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  async close() {
    this._running = false;
    try {
      await this.reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this._parsePromise;
    } catch {
      /* ignore */
    }
  }

  async setPinMode(pin, mode) {
    await this.writer.write(buildSetPinMode(pin, mode));
    await new Promise((r) => setTimeout(r, 15));
  }

  /**
   * Escritura digital (0/1). Actualiza máscara del puerto y envía 0x90.
   */
  async digitalWrite(pin, high) {
    const port = portForPin(pin);
    const bit = bitForPin(pin);
    let mask = this._outMask[port];
    if (high) mask |= 1 << bit;
    else mask &= ~(1 << bit);
    this._outMask[port] = mask;
    const b0 = mask & 0x7f;
    const b1 = (mask >> 7) & 0x7f;
    await this.writer.write(new Uint8Array([0x90 | port, b0, b1]));
    await new Promise((r) => setTimeout(r, 5));
  }

  async pwmWrite(pin, value0to255) {
    const v = Math.max(0, Math.min(255, value0to255));
    const ext = Math.round((v / 255) * 16383);
    await this.writer.write(buildExtendedAnalog(pin, ext));
    await new Promise((r) => setTimeout(r, 5));
  }

  async servoWrite(pin, angle0to180) {
    const a = Math.max(0, Math.min(180, angle0to180));
    this._servoPins.add(pin);
    await this.setPinMode(pin, MODE_SERVO);
    await this.writer.write(buildExtendedAnalog(pin, a));
    await new Promise((r) => setTimeout(r, 10));
  }

  async motorWrite(pin, speed) {
    const s = Math.max(-100, Math.min(100, speed));
    if (s === 0) {
      const servoVal = Math.max(0, Math.min(180, 90));
      await this.servoWrite(pin, servoVal);
      await new Promise((r) => setTimeout(r, 25));
      this._servoPins.delete(pin);
      await this.setPinMode(pin, MODE_OUTPUT);
      await this.digitalWrite(pin, false);
      return;
    }
    const ang = speedToServoAngle(s);
    await this.servoWrite(pin, ang);
  }

  async ensureDigitalIn(pin) {
    await this.setPinMode(pin, MODE_INPUT);
    await new Promise((r) => setTimeout(r, 40));
  }

  /**
   * @param {number} pin
   * @returns {boolean}
   */
  readDigitalCached(pin) {
    const port = portForPin(pin);
    const bit = bitForPin(pin);
    return ((this._inMask[port] >> bit) & 1) === 1;
  }

  /**
   * @param {number} channel 0 = A0
   */
  readAnalogCached(channel) {
    return this._analog[channel] ?? 0;
  }
}

/**
 * Abre puerto serie y crea sesión Firmata (sin fijar servo en un pin al inicio).
 */
export async function connectFirmataSession(port, options = {}) {
  const baudRates = options.baudRates ?? [57600, 115200];
  let lastErr;

  for (const baudRate of baudRates) {
    try {
      if (port.readable || port.writable) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      }
      await port.open({ baudRate });
      const writer = port.writable.getWriter();
      const reader = port.readable.getReader();
      const session = new FirmataSession(writer, reader);
      await session.init();

      const close = async () => {
        await session.close();
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        try {
          writer.releaseLock();
        } catch {
          /* ignore */
        }
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      };

      return { session, writer, reader, port, baudRate, close };
    } catch (e) {
      lastErr = e;
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    }
  }

  throw lastErr ?? new Error("No se pudo abrir el puerto");
}
