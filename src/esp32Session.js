/**
 * EXPERIMENTAL — NO es el flujo principal de ESP32.
 *
 * El modo principal de ESP32 es MicroPython (src/micropythonEsp32Session.js).
 * Este driver JSON serial queda como experimento: no aparece en el selector y
 * solo se activa con localStorage pybot_board_type = "esp32-serial". No afecta
 * a Arduino.
 *
 * Driver ESP32 (firmware PyBot ESP32) sobre Web Serial.
 *
 * Modelo: request/response. Se envía un comando JSON por línea y se espera
 * una respuesta JSON por línea. Es un modelo distinto al de Firmata
 * (streaming/cache), por eso ESP32 tiene su propio adaptador en lugar de
 * imitar los métodos internos de FirmataSession.
 *
 * Esp32SerialAdapter expone la MISMA interfaz de alto nivel que
 * ArduinoFirmataAdapter hacia hardwareBridge.js:
 *   pinWrite(pin, value)
 *   pinRead(pin)
 *   pwmWrite(pin, value)
 *   servoWrite(pin, angle)
 *   motorWrite(pin, speed)
 *   close()
 *
 * Direccionamiento: número de GPIO directo (no se mapea A0–A5).
 *   pin("out", 2, 1)   -> digital
 *   pin("in", 4)       -> lectura digital
 *   pin("in", "A34")   -> lectura analógica en GPIO 34 (devuelta escalada 0–1023)
 *   pin("pwm", 18, 128)-> PWM
 */

const DEFAULT_BAUD = 115200;
const HELLO_TIMEOUT_MS = 2500;
const CMD_TIMEOUT_MS = 1500;
const BOOT_DELAY_MS = 1200;

function clampInt(value, lo, hi) {
  let n = parseInt(String(value), 10);
  if (Number.isNaN(n)) n = 0;
  return Math.max(lo, Math.min(hi, n));
}

export class Esp32SerialAdapter {
  /**
   * @param {WritableStreamDefaultWriter} writer
   * @param {ReadableStreamDefaultReader} reader
   * @param {() => Promise<void>} closeFn
   */
  constructor(writer, reader, closeFn) {
    this.writer = writer;
    this.reader = reader;
    this._closeFn = closeFn;
    this._encoder = new TextEncoder();
    this._decoder = new TextDecoder();
    this._rxBuf = "";
    /** @type {{resolve:Function,reject:Function,timer:any}[]} cola FIFO de comandos en vuelo */
    this._pending = [];
    this._running = true;
    this._readPromise = this._readLoop();
  }

  async _readLoop() {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done || !this._running) break;
        if (!value) continue;
        this._rxBuf += this._decoder.decode(value, { stream: true });
        let idx;
        while ((idx = this._rxBuf.indexOf("\n")) >= 0) {
          const line = this._rxBuf.slice(0, idx).trim();
          this._rxBuf = this._rxBuf.slice(idx + 1);
          if (line) this._onLine(line);
        }
      }
    } catch {
      /* cancel() o cierre del puerto */
    }
  }

  _onLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // Ruido de arranque del ESP32 u otras líneas no-JSON: se ignoran.
      return;
    }
    const p = this._pending.shift();
    if (!p) return;
    clearTimeout(p.timer);
    p.resolve(obj);
  }

  _send(cmdObj, timeoutMs = CMD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const i = this._pending.indexOf(entry);
        if (i >= 0) this._pending.splice(i, 1);
        reject(new Error("NO_RESPONSE"));
      }, timeoutMs);
      this._pending.push(entry);
      const line = JSON.stringify(cmdObj) + "\n";
      this.writer.write(this._encoder.encode(line)).catch((e) => {
        clearTimeout(entry.timer);
        const i = this._pending.indexOf(entry);
        if (i >= 0) this._pending.splice(i, 1);
        reject(e);
      });
    });
  }

  async _cmd(cmdObj) {
    const res = await this._send(cmdObj);
    if (res && res.ok === false) {
      const err = String(res.error ?? "").toLowerCase();
      if (err.includes("pin")) throw new Error("INVALID_PIN");
      if (err.includes("cmd") || err.includes("command")) throw new Error("INVALID_CMD");
      throw new Error("CMD_FAILED");
    }
    return res;
  }

  /** Handshake: valida que del otro lado haya firmware PyBot ESP32. */
  async hello() {
    let res;
    try {
      res = await this._send({ cmd: "hello" }, HELLO_TIMEOUT_MS);
    } catch {
      throw new Error("NO_RESPONSE");
    }
    if (!res || res.ok !== true || res.board !== "esp32") {
      throw new Error("BAD_FIRMWARE");
    }
    return res;
  }

  _gpio(pinId) {
    const n = parseInt(String(pinId), 10);
    if (Number.isNaN(n) || n < 0 || n > 39) throw new Error("INVALID_PIN");
    return n;
  }

  async pinWrite(pinId, value) {
    const pin = this._gpio(pinId);
    const v = parseInt(String(value), 10);
    if (Number.isNaN(v) || v < 0 || v > 255) throw new Error("invalid_value");
    if (v > 1) {
      await this.pwmWrite(pin, v);
      return;
    }
    await this._cmd({ cmd: "pin_write", pin, value: v === 1 ? 1 : 0 });
  }

  async pwmWrite(pinId, value) {
    const pin = this._gpio(pinId);
    const v = clampInt(value, 0, 255);
    await this._cmd({ cmd: "pwm_write", pin, value: v });
  }

  async pinRead(pinId) {
    const sid = String(pinId ?? "");
    if (sid.toUpperCase().startsWith("A")) {
      const gpio = parseInt(sid.slice(1), 10);
      if (Number.isNaN(gpio) || gpio < 0 || gpio > 39) throw new Error("INVALID_PIN");
      const res = await this._cmd({ cmd: "analog_read", pin: gpio });
      // El firmware ya escala la ADC (12 bits) a 0–1023 para igualar a Arduino.
      return Number(res?.value ?? 0);
    }
    const gpio = this._gpio(sid);
    const res = await this._cmd({ cmd: "pin_read", pin: gpio });
    return Number(res?.value ?? 0) === 1;
  }

  async servoWrite(pinId, angle) {
    const pin = this._gpio(pinId);
    const a = clampInt(angle, 0, 180);
    await this._cmd({ cmd: "servo_write", pin, angle: a });
  }

  async motorWrite(pinId, speed) {
    const pin = this._gpio(pinId);
    // Misma semántica que escritorio/Arduino: -100..100 como servo de rotación
    // continua (la conversión a ángulo y el "stop" en 90 los hace el firmware).
    const s = clampInt(speed, -100, 100);
    await this._cmd({ cmd: "motor_write", pin, speed: s });
  }

  async close() {
    this._running = false;
    for (const p of this._pending) {
      clearTimeout(p.timer);
      try {
        p.reject(new Error("closed"));
      } catch {
        /* ignore */
      }
    }
    this._pending = [];
    if (this._closeFn) {
      try {
        await this._closeFn();
      } catch {
        /* ignore */
      }
    }
    try {
      await this._readPromise;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Abre el puerto serie, crea el adaptador ESP32 y valida el firmware (handshake).
 * @returns {Promise<{ adapter: Esp32SerialAdapter, baudRate: number, close: () => Promise<void> }>}
 * @throws {Error} con mensaje "NO_RESPONSE" o "BAD_FIRMWARE"
 */
export async function connectEsp32Session(port, options = {}) {
  const baudRate = options.baudRate ?? DEFAULT_BAUD;

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

  const lowLevelClose = async () => {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
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

  const adapter = new Esp32SerialAdapter(writer, reader, lowLevelClose);

  // Al abrir el puerto, muchos ESP32 se resetean (DTR/RTS) y emiten log de
  // arranque. Esperamos a que termine antes del handshake.
  await new Promise((r) => setTimeout(r, BOOT_DELAY_MS));

  try {
    await adapter.hello();
  } catch (e) {
    await adapter.close();
    throw e;
  }

  return { adapter, baudRate, close: () => adapter.close() };
}
