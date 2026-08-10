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
const BOOT_DELAY_MS = 1200;

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
_out_pins = {}

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
        p = _out_pins.get(gpio)
        if p is None:
            p = machine.Pin(gpio, machine.Pin.OUT)
            _out_pins[gpio] = p
        p.value(1 if v == 1 else 0)

def _pybot_cleanup():
    # Cleanup de hardware para GPIO directo: apaga y libera SOLO lo creado por
    # PyBot (PWM y salidas), a estado seguro. No toca entradas. Lo llama el
    # runtime BLE al detener/terminar/reemplazar un programa.
    for gpio in list(_pwm_cache.keys()):
        p = _pwm_cache.get(gpio)
        try:
            p.duty_u16(0)
        except Exception:
            try:
                p.duty(0)
            except Exception:
                pass
        try:
            p.deinit()
        except Exception:
            pass
    _pwm_cache.clear()
    _pwm_freq.clear()
    for gpio in list(_out_pins.keys()):
        p = _out_pins.get(gpio)
        try:
            p.value(0)
        except Exception:
            pass

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
    this._abortRun = false;
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
      if (bytes.length > CH) await sleep(5);
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

  /** Respuesta OK del raw REPL de MicroPython (evita falsos positivos con subcadenas). */
  _waitForRawReplOk(timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (/(?:^|\r?\n)OK\r?(?:\n|$)/.test(this._buf)) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
        this._waitData(80).then(check);
      };
      check();
    });
  }

  _sliceAfterRawReplOk() {
    const m = this._buf.match(/(?:^|\r?\n)OK\r?(?:\n|$)/);
    if (!m) return;
    this._buf = this._buf.slice(m.index + m[0].length);
  }

  /**
   * Lee y emite (onChunk) hasta encontrar el marcador. Si shouldStop() pasa a
   * true, envía Ctrl-C para interrumpir el programa en la placa.
   */
  async _drainTo(marker, onChunk, shouldStop) {
    let interrupted = false;
    let interruptAt = 0;
    for (;;) {
      // Errores de runtime aparecen en el buffer antes del marcador 0x04.
      if (onChunk && /Traceback \(most recent call last\)/.test(this._buf)) {
        const idx = this._buf.indexOf(marker);
        const end = idx >= 0 ? idx : this._buf.length;
        const chunk = this._buf.slice(0, end);
        this._buf = idx >= 0 ? this._buf.slice(idx + marker.length) : "";
        if (chunk) onChunk(chunk);
        if (idx >= 0) return;
      }
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
      const stopNow = this._abortRun || (shouldStop && shouldStop());
      if (!interrupted && stopNow) {
        interrupted = true;
        interruptAt = Date.now();
        try {
          await this._write(CTRL_C);
        } catch {
          /* ignore */
        }
      }
      // Tras Detener, no esperar para siempre (p. ej. while True sin salida).
      if (interrupted && Date.now() - interruptAt > 4000) {
        return;
      }
      await this._waitData(120);
      if (!this._running) return;
    }
  }

  /** Detecta MicroPython entrando y saliendo de raw REPL (hasta 3 intentos). */
  async detect() {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this._write("\r" + CTRL_C + CTRL_C);
      await sleep(200);
      this._buf = "";
      try {
        await this._write(CTRL_A);
        await this._waitForContains("raw REPL", attempt === 0 ? 3000 : 4000);
        await this._write(CTRL_B);
        await sleep(60);
        this._buf = "";
        return true;
      } catch {
        if (attempt < 2) await sleep(300);
      }
    }
    return false;
  }

  async _enterRawRepl() {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this._write("\r" + CTRL_C + CTRL_C);
      await sleep(attempt === 0 ? 200 : 400);
      this._buf = "";
      try {
        await this._write(CTRL_A);
        await this._waitForContains("raw REPL", attempt === 0 ? 3000 : 4000);
        await this._waitForContains(">", 2000).catch(() => {});
        this._buf = "";
        return;
      } catch {
        if (attempt === 2) throw new Error("REPL_FAIL");
        await sleep(300);
      }
    }
  }

  /**
   * Ejecuta el código del alumno (con prelude) en la placa y transmite la salida.
   * @param {string} userCode
   * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function,prelude?:string}} cb
   */
  async runProgram(userCode, cb = {}) {
    const { onOut, onErr, shouldStop, prelude, onStarted } = cb;
    if (!this._running) throw new Error("RUN_FAIL");

    this._abortRun = false;
    const prefix = prelude != null ? prelude : MPY_PRELUDE;
    const program = prefix + "\n" + String(userCode ?? "") + "\n";
    const okTimeout = Math.min(45000, Math.max(10000, 8000 + Math.floor(program.length / 150)));

    await this._enterRawRepl();
    this._buf = "";
    await this._write(program);
    await sleep(program.length > 5000 ? 200 : 80);
    await this._write(CTRL_D);

    try {
      await this._waitForRawReplOk(okTimeout);
    } catch {
      // Si falló, puede haber traceback en el buffer (p. ej. SyntaxError al compilar).
      const errPreview = this._buf.slice(-800);
      if (/Traceback|SyntaxError|ImportError|NameError|MemoryError/i.test(errPreview) && onErr) {
        onErr(errPreview);
      }
      throw new Error("RUN_FAIL");
    }
    this._sliceAfterRawReplOk();

    if (onStarted) onStarted();

    const emitOut = (chunk) => {
      if (!chunk) return;
      if (/Traceback \(most recent call last\)/.test(chunk)) {
        if (onErr) onErr(chunk);
        return;
      }
      if (onOut) onOut(chunk);
    };

    // stdout hasta el primer 0x04 (programas con while True pueden no terminar nunca).
    await this._drainTo(CTRL_D, emitOut, shouldStop);

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

  /**
   * Ejecuta código utilitario en raw REPL y devuelve stdout/stderr (programa corto).
   * @param {string} code
   * @param {{timeout?:number}} options
   */
  async execRaw(code, options = {}) {
    const timeout = options.timeout ?? 15000;
    if (!this._running) throw new Error("RUN_FAIL");

    await this._enterRawRepl();
    this._buf = "";
    await this._write(String(code ?? "") + "\n");
    await this._write(CTRL_D);

    try {
      await this._waitForRawReplOk(timeout);
    } catch {
      throw new Error("RUN_FAIL");
    }
    this._sliceAfterRawReplOk();

    let stdout = "";
    let stderr = "";
    await this._drainTo(CTRL_D, (chunk) => { stdout += chunk; }, null);
    await this._drainTo(CTRL_D, (chunk) => { stderr += chunk; }, null);

    try {
      await this._write(CTRL_B);
    } catch {
      /* ignore */
    }
    return { stdout, stderr };
  }

  /** Recupera REPL si main.py u otro programa está corriendo. */
  async interruptAndRecoverRepl() {
    try {
      await this._write("\r" + CTRL_C + CTRL_C);
      await sleep(300);
      this._buf = "";
    } catch {
      /* ignore */
    }
  }

  /** @param {string} path */
  async fileExists(path) {
    const safe = String(path).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const code = [
      "import os",
      "try:",
      `    os.stat('${safe}')`,
      "    print('PYBOT_FILE_EXISTS')",
      "except OSError:",
      "    print('PYBOT_FILE_MISSING')",
    ].join("\n");
    const { stdout } = await this.execRaw(code, { timeout: 8000 });
    return stdout.includes("PYBOT_FILE_EXISTS");
  }

  /**
   * @param {string} path @param {string} content
   * @param {{ onProgress?: (info: { done: number, total: number, pct: number }) => void }} [options]
   */
  async installFile(path, content, options = {}) {
    const onProgress = options.onProgress;
    const bytes = new TextEncoder().encode(String(content ?? ""));
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const CHUNK = 1024;
    const chunks = [];
    for (let i = 0; i < b64.length; i += CHUNK) {
      chunks.push(b64.slice(i, i + CHUNK));
    }
    const safePath = String(path).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    await this.execRaw(
      `with open('${safePath}', 'wb') as f:\n    pass\nprint('PYBOT_INSTALL_OK')`,
      { timeout: 8000 },
    );

    const total = chunks.length || 1;
    let done = 0;
    for (const chunk of chunks) {
      const safeChunk = chunk.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const code = [
        "import ubinascii",
        `with open('${safePath}', 'ab') as f:`,
        `    f.write(ubinascii.a2b_base64('${safeChunk}'))`,
        "print('PYBOT_INSTALL_OK')",
      ].join("\n");
      const { stdout } = await this.execRaw(code, { timeout: 15000 });
      if (!stdout.includes("PYBOT_INSTALL_OK")) {
        throw new Error("INSTALL_FAIL");
      }
      done += 1;
      if (onProgress) {
        onProgress({ done, total, pct: Math.round((done / total) * 100) });
      }
    }
  }

  async syncFilesystem() {
    const code = [
      "try:",
      "    import os",
      "    os.sync()",
      "except (AttributeError, ImportError):",
      "    pass",
      "print('PYBOT_SYNC_OK')",
    ].join("\n");
    await this.execRaw(code, { timeout: 8000 });
  }

  /** @param {string} path */
  async getFileSize(path) {
    const safe = String(path).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const code = [
      "import os",
      `print(os.stat('${safe}')[6])`,
    ].join("\n");
    const { stdout } = await this.execRaw(code, { timeout: 8000 });
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const n = parseInt(lines[lines.length - 1], 10);
    return Number.isNaN(n) ? -1 : n;
  }

  /**
   * Verifica main.py en la placa antes de reiniciar.
   * @param {boolean} checkEda6
   * @returns {Promise<{ok:boolean, mainSize:number, detail:string}>}
   */
  async verifyMainPyOnBoard(checkEda6 = false) {
    const code = [
      "import os",
      "_ok = True",
      "_detail = ''",
      "try:",
      "    _sz = os.stat('main.py')[6]",
      "except OSError:",
      "    _ok = False",
      "    _detail = 'missing_main'",
      "    _sz = -1",
      "if _ok:",
      "    try:",
      "        compile(open('main.py').read(), 'main.py', 'exec')",
      "    except Exception as e:",
      "        _ok = False",
      "        _detail = 'compile:' + str(e)",
      checkEda6
        ? [
            "if _ok:",
            "    try:",
            "        import EDA6",
            "    except Exception as e:",
            "        _ok = False",
            "        _detail = 'eda6:' + str(e)",
          ].join("\n")
        : [
            "if _ok:",
            "    try:",
            "        import pybot_hw",
            "    except Exception as e:",
            "        _ok = False",
            "        _detail = 'pybot_hw:' + str(e)",
          ].join("\n"),
      "print('PYBOT_VERIFY', _ok, _sz, _detail)",
    ].join("\n");
    const { stdout } = await this.execRaw(code, { timeout: 20000 });
    const line = stdout.split(/\r?\n/).find((l) => l.includes("PYBOT_VERIFY"));
    if (!line) return { ok: false, mainSize: -1, detail: "no_response" };
    const parts = line.replace("PYBOT_VERIFY", "").trim().split(/\s+/);
    const ok = parts[0] === "True";
    const mainSize = parseInt(parts[1], 10);
    const detail = parts.slice(2).join(" ") || "";
    return { ok, mainSize: Number.isNaN(mainSize) ? -1 : mainSize, detail };
  }

  /** Reinicio por señal DTR/RTS (más fiable en ESP32 que machine.reset por serial). */
  async hardwareReset() {
    const port = this.port;
    if (!port || typeof port.setSignals !== "function") return false;
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(120);
      await port.setSignals({ dataTerminalReady: true, requestToSend: false });
      await sleep(1600);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} path */
  async removeFile(path) {
    const safe = String(path).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const code = [
      "import os",
      "try:",
      `    os.remove('${safe}')`,
      "    print('PYBOT_REMOVE_OK')",
      "except OSError:",
      "    print('PYBOT_REMOVE_MISSING')",
    ].join("\n");
    const { stdout } = await this.execRaw(code, { timeout: 8000 });
    if (!stdout.includes("PYBOT_REMOVE_OK") && !stdout.includes("PYBOT_REMOVE_MISSING")) {
      throw new Error("REMOVE_FAIL");
    }
    return stdout.includes("PYBOT_REMOVE_OK");
  }

  /**
   * Reinicia la placa para que MicroPython ejecute main.py al arrancar.
   * Tras el reset la sesión serial deja de ser usable.
   */
  async softReset() {
    await this.syncFilesystem();
    const hw = await this.hardwareReset();
    if (hw) {
      this._running = false;
      return;
    }
    try {
      await this._enterRawRepl();
      this._buf = "";
      await this._write("import machine\nmachine.reset()\n");
      await this._write(CTRL_D);
      await sleep(600);
    } catch {
      /* la placa ya se reinició o el puerto se cerró */
    }
    this._running = false;
  }

  /** Interrumpe el programa en ejecución (Ctrl-C). */
  async interrupt() {
    this._abortRun = true;
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
  const recoverRepl = options.recoverRepl === true;
  const mode = options.mode ?? "esp32-micropython";

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

  if (recoverRepl) {
    await session.interruptAndRecoverRepl();
  }

  return { session, baudRate, mode };
}
