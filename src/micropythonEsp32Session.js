/**
 * Sesión MicroPython para ESP32 sobre Web Serial.
 *
 * Enfoque PRINCIPAL de ESP32 en PyBot: el programa del alumno corre NATIVAMENTE
 * en la placa usando MicroPython (no en Pyodide). PyBot habla con el REPL / raw
 * REPL de MicroPython:
 *   - detecta MicroPython,
 *   - inyecta un prelude que define pin/servo/motor/wait con la misma API,
 *   - envía el programa completo y lo ejecuta en la placa,
 *   - captura stdout/stderr y los muestra en la terminal del IDE.
 *
 * No reescribe firmataSession.js (Arduino) ni depende del firmware JSON
 * experimental (esp32Session.js).
 *
 * Direccionamiento: número de GPIO directo (NO A0–A5). Si el alumno usa "A0",
 * el prelude levanta ESP32_GPIO_ONLY y el IDE muestra un mensaje educativo.
 *
 * Lectura analógica: la ADC del ESP32 (0–4095) se escala a 0–1023 para mantener
 * compatibilidad pedagógica con Arduino.
 */

const DEFAULT_BAUD = 115200;
const BOOT_DELAY_MS = 300;

// Códigos de control del REPL de MicroPython.
const CTRL_A = "\x01"; // entrar a raw REPL
const CTRL_B = "\x02"; // volver a REPL normal
const CTRL_C = "\x03"; // interrumpir (KeyboardInterrupt)
const CTRL_D = "\x04"; // ejecutar en raw REPL / fin de bloque

/**
 * Prelude MicroPython: define la API del alumno (misma que PyBot escritorio).
 * Se antepone al código antes de enviarlo a la placa.
 */
export const MPY_PRELUDE = `import machine, time

def wait(seconds):
    time.sleep(seconds)

_pwm_cache = {}
_pwm_freq = {}
_adc_cache = {}

def _pwm(gpio, freq):
    p = _pwm_cache.get(gpio)
    if p is not None and _pwm_freq.get(gpio) == freq:
        return p
    if p is not None:
        try:
            p.deinit()
        except Exception:
            pass
    p = machine.PWM(machine.Pin(gpio))
    try:
        p.freq(freq)
    except Exception:
        pass
    _pwm_cache[gpio] = p
    _pwm_freq[gpio] = freq
    return p

def _set_duty(p, value):
    v = int(value)
    if v < 0:
        v = 0
    if v > 255:
        v = 255
    duty = v * 65535 // 255
    try:
        p.duty_u16(duty)
    except Exception:
        p.duty(duty * 1023 // 65535)

def _set_pulse_us(p, pulse_us):
    # Periodo 20000 us (50 Hz)
    duty = int(pulse_us) * 65535 // 20000
    try:
        p.duty_u16(duty)
    except Exception:
        p.duty(duty * 1023 // 65535)

def _is_adc(gpio):
    return gpio in (32, 33, 34, 35, 36, 37, 38, 39)

def _read_analog(gpio):
    a = _adc_cache.get(gpio)
    if a is None:
        a = machine.ADC(machine.Pin(gpio))
        try:
            a.atten(machine.ADC.ATTN_11DB)
        except Exception:
            pass
        try:
            a.width(machine.ADC.WIDTH_12BIT)
        except Exception:
            pass
        _adc_cache[gpio] = a
    try:
        raw = a.read()
    except Exception:
        raw = a.read_u16() * 4095 // 65535
    return int(raw) * 1023 // 4095

def _gpio(value):
    if isinstance(value, str):
        raise ValueError("ESP32_GPIO_ONLY")
    return int(value)

def _read(gpio):
    if _is_adc(gpio):
        return _read_analog(gpio)
    return machine.Pin(gpio, machine.Pin.IN).value()

def _write(gpio, value):
    v = int(value)
    if v > 1:
        _set_duty(_pwm(gpio, 1000), v)
    else:
        machine.Pin(gpio, machine.Pin.OUT).value(1 if v == 1 else 0)

def pin(*args):
    if len(args) == 0:
        raise ValueError("pin: faltan argumentos")
    first = args[0]
    if isinstance(first, str) and first.lower() in ("in", "out", "pwm"):
        mode = first.lower()
        if len(args) < 2:
            raise ValueError("pin: falta el numero de GPIO")
        gpio = _gpio(args[1])
        value = args[2] if len(args) >= 3 else None
        if mode == "in":
            return _read(gpio)
        if mode == "pwm":
            _set_duty(_pwm(gpio, 1000), 0 if value is None else value)
            return None
        _write(gpio, 0 if value is None else value)
        return None
    gpio = _gpio(first)
    if len(args) == 1:
        return _read(gpio)
    _write(gpio, args[1])
    return None

def _servo_pulse(gpio, angle):
    a = int(angle)
    if a < 0:
        a = 0
    if a > 180:
        a = 180
    pulse = 500 + a * 2000 // 180
    _set_pulse_us(_pwm(gpio, 50), pulse)

def servo(pin, angle, angle_end=None, speed=5):
    gpio = _gpio(pin)
    if angle_end is None:
        _servo_pulse(gpio, angle)
        return
    a = int(angle)
    ae = int(angle_end)
    spd = max(1, min(10, int(speed)))
    step = 1 if ae >= a else -1
    delay = 0.05 / (spd / 5)
    x = a
    while True:
        _servo_pulse(gpio, x)
        time.sleep(delay)
        if x == ae:
            break
        x += step

def motor(pin, speed=0):
    gpio = _gpio(pin)
    s = int(speed)
    if s < -100:
        s = -100
    if s > 100:
        s = 100
    _servo_pulse(gpio, 90 + s * 90 // 100)
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MicroPythonSession {
  constructor(port, writer, reader, baudRate) {
    this.port = port;
    this.writer = writer;
    this.reader = reader;
    this.baudRate = baudRate;
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this._buf = "";
    this._waiters = new Set();
    this._running = true;
    this._readPromise = this._readLoop();
  }

  async _readLoop() {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done || !this._running) break;
        if (value && value.length) {
          this._buf += this._dec.decode(value, { stream: true });
          this._notify();
        }
      }
    } catch {
      /* cancel() o cierre */
    }
  }

  _notify() {
    const ws = this._waiters;
    this._waiters = new Set();
    ws.forEach((w) => w());
  }

  _waitData(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this._waiters.add(fin);
      setTimeout(fin, timeoutMs);
    });
  }

  async _write(s) {
    const bytes = this._enc.encode(s);
    const CH = 128;
    for (let i = 0; i < bytes.length; i += CH) {
      await this.writer.write(bytes.slice(i, i + CH));
      if (bytes.length > CH) await sleep(3);
    }
  }

  _waitForContains(str, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (this._buf.includes(str)) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
        this._waitData(80).then(check);
      };
      check();
    });
  }

  /**
   * Lee y emite (onChunk) hasta encontrar el marcador. Si shouldStop() pasa a
   * true, envía Ctrl-C para interrumpir el programa en la placa.
   */
  async _drainTo(marker, onChunk, shouldStop) {
    let interrupted = false;
    for (;;) {
      const idx = this._buf.indexOf(marker);
      if (idx >= 0) {
        const chunk = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + marker.length);
        if (chunk && onChunk) onChunk(chunk);
        return;
      }
      if (this._buf.length > 0) {
        const chunk = this._buf;
        this._buf = "";
        if (onChunk) onChunk(chunk);
      }
      if (!interrupted && shouldStop && shouldStop()) {
        interrupted = true;
        try {
          await this._write(CTRL_C);
        } catch {
          /* ignore */
        }
      }
      await this._waitData(120);
      if (!this._running) return;
    }
  }

  /** Detecta MicroPython entrando y saliendo de raw REPL. */
  async detect() {
    await this._write("\r" + CTRL_C + CTRL_C);
    await sleep(200);
    this._buf = "";
    try {
      await this._write(CTRL_A);
      await this._waitForContains("raw REPL", 1500);
      await this._write(CTRL_B);
      await sleep(60);
      this._buf = "";
      return true;
    } catch {
      return false;
    }
  }

  async _enterRawRepl() {
    await this._write("\r" + CTRL_C + CTRL_C);
    await sleep(80);
    this._buf = "";
    await this._write(CTRL_A);
    try {
      await this._waitForContains("raw REPL", 2000);
    } catch {
      throw new Error("REPL_FAIL");
    }
    await this._waitForContains(">", 1500).catch(() => {});
    this._buf = "";
  }

  /**
   * Ejecuta el código del alumno (con prelude) en la placa y transmite la salida.
   * @param {string} userCode
   * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function}} cb
   */
  async runProgram(userCode, cb = {}) {
    const { onOut, onErr, shouldStop } = cb;
    if (!this._running) throw new Error("RUN_FAIL");

    const program = MPY_PRELUDE + "\n" + String(userCode ?? "") + "\n";

    await this._enterRawRepl();
    this._buf = "";
    await this._write(program);
    await this._write(CTRL_D);

    try {
      await this._waitForContains("OK", 5000);
    } catch {
      throw new Error("RUN_FAIL");
    }
    const okIdx = this._buf.indexOf("OK");
    this._buf = this._buf.slice(okIdx + 2);

    // stdout hasta el primer 0x04
    await this._drainTo(CTRL_D, (chunk) => { if (onOut && chunk) onOut(chunk); }, shouldStop);

    // stderr hasta el segundo 0x04
    let errText = "";
    await this._drainTo(CTRL_D, (chunk) => { errText += chunk; }, null);

    if (errText && errText.trim()) {
      if (/KeyboardInterrupt/.test(errText)) {
        if (onOut) onOut("\n[Detenido]\n");
      } else if (onErr) {
        onErr(errText);
      }
    }

    try {
      await this._write(CTRL_B);
    } catch {
      /* ignore */
    }
  }

  /** Interrumpe el programa en ejecución (Ctrl-C). */
  async interrupt() {
    try {
      await this._write(CTRL_C);
    } catch {
      /* ignore */
    }
  }

  async close() {
    this._running = false;
    try {
      await this._write("\r" + CTRL_C + CTRL_C + CTRL_B);
    } catch {
      /* ignore */
    }
    try {
      await this.reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this._readPromise;
    } catch {
      /* ignore */
    }
    try {
      this.reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Abre el puerto, detecta MicroPython y deja la sesión lista.
 * @returns {Promise<{session: MicroPythonSession, baudRate:number, mode:string}>}
 * @throws {Error} "BUSY" | "NEEDS_PREP"
 */
export async function connectMicroPythonEsp32Session(port, options = {}) {
  const baudRate = options.baudRate ?? DEFAULT_BAUD;

  if (port.readable || port.writable) {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }

  try {
    await port.open({ baudRate });
  } catch {
    throw new Error("BUSY");
  }

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const session = new MicroPythonSession(port, writer, reader, baudRate);

  await sleep(BOOT_DELAY_MS);

  let ok = false;
  try {
    ok = await session.detect();
  } catch {
    ok = false;
  }
  if (!ok) {
    await session.close();
    throw new Error("NEEDS_PREP");
  }

  return { session, baudRate, mode: "esp32-micropython" };
}
