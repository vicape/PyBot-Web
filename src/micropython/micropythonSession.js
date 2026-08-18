/**
 * Sesión MicroPython: USB Serial y BLE REPL comparten este motor.
 *
 * ByteTransport → MicroPythonReplProtocol → raw REPL / raw-paste.
 */

import { SerialByteTransport } from "./serialByteTransport.js";
import { MicroPythonReplProtocol } from "./replProtocol.js";
import { buildRunnableProgram } from "./programWrap.js";
import { MPY_PRELUDE } from "./usbPrelude.js";
import { protocolError, PROTOCOL_ERROR, errorCode } from "./errors.js";
import {
  DEFAULT_BAUD,
  BOOT_DELAY_MS,
  RAW_REPL_FOLLOW_AFTER_INTERRUPT_MS,
  RAW_REPL_STDERR_TIMEOUT_MS,
} from "./constants.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { MPY_PRELUDE };

export class MicroPythonSession {
  /**
   * @param {object} transportOrPort  ByteTransport o SerialPort (compat tests)
   * @param {object} [writer]
   * @param {object} [reader]
   * @param {number} [baudRate]
   */
  constructor(transportOrPort, writer, reader, baudRate) {
    if (writer && typeof writer.write === "function" && reader) {
      this.transport = new SerialByteTransport(
        transportOrPort,
        writer,
        reader,
        baudRate,
      );
      this.port = transportOrPort;
    } else {
      this.transport = transportOrPort;
      this.port = transportOrPort.port ?? null;
    }
    this.writer = this.transport.writer ?? writer ?? null;
    this.reader = this.transport.reader ?? reader ?? null;
    this.baudRate = baudRate ?? this.transport.baudRate ?? DEFAULT_BAUD;
    this.protocol = new MicroPythonReplProtocol(this.transport);
    this._running = true;
    this._interrupted = false;
    this._useRawPaste = true;
  }

  async _write(s) {
    await this.protocol.write(s);
  }

  async _enterRawRepl() {
    await this.protocol.enterRawRepl();
  }

  async _execProgramBytes(program) {
    if (this._useRawPaste) {
      const pasted = await this.protocol.executeRawPaste(program);
      if (pasted.supported) return;
      this._useRawPaste = false;
    }
    await this.protocol.executeRawClassic(program);
  }

  async detect() {
    if (!this._running) return false;
    try {
      await this.protocol.enterRawRepl();
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* exit is best-effort after a successful banner */
      }
      return true;
    } catch (e) {
      if (errorCode(e) === PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT) return false;
      throw e;
    }
  }

  /**
   * Ejecuta el código del alumno en la placa y transmite stdout/stderr.
   * @param {string} userCode
   * @param {{onOut?:Function,onErr?:Function,shouldStop?:Function,prelude?:string,onStarted?:Function,wrap?:boolean}} cb
   */
  async runProgram(userCode, cb = {}) {
    const { onOut, onErr, prelude, onStarted, shouldStop } = cb;
    if (!this._running) throw protocolError(PROTOCOL_ERROR.CLOSED);
    this._interrupted = false;
    const stopRequested = () =>
      this._interrupted ||
      (typeof shouldStop === "function" && shouldStop() === true);
    const finishInterruptedBeforeFollow = async () => {
      this._interrupted = true;
      if (onOut) onOut("\n[Detenido]\n");
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* best-effort: el siguiente Run recupera raw REPL antes de enviar código */
      }
      return { stdout: "", stderr: "", interrupted: true };
    };

    const prefix = prelude != null ? prelude : MPY_PRELUDE;
    const wrap = cb.wrap !== false;
    const program = wrap
      ? buildRunnableProgram(prefix, userCode)
      : prefix + "\n" + String(userCode ?? "") + "\n";

    if (stopRequested()) return finishInterruptedBeforeFollow();

    try {
      await this.protocol.enterRawRepl();
      if (stopRequested()) return finishInterruptedBeforeFollow();
      await this._execProgramBytes(program);
    } catch (e) {
      if (stopRequested()) return finishInterruptedBeforeFollow();
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* cleanup */
      }
      throw e;
    }

    // Stop puede llegar mientras el programa todavía se estaba transfiriendo.
    // En ese caso el Ctrl+C urgente ya fue inyectado por el transporte BLE: no
    // anunciar falsamente "programa en ejecución"; sí consumir los EOF de raw REPL.
    if (stopRequested()) this._interrupted = true;
    if (!this._interrupted && onStarted) onStarted();

    const followOpts = {};
    if (onOut) followOpts.onStdout = onOut;
    if (this._interrupted) {
      followOpts.stdoutTimeout = RAW_REPL_FOLLOW_AFTER_INTERRUPT_MS;
      followOpts.stderrTimeout = RAW_REPL_FOLLOW_AFTER_INTERRUPT_MS;
    }

    let result;
    try {
      result = await this.protocol.followExecution(followOpts);
    } catch (e) {
      if (this._interrupted && errorCode(e) === PROTOCOL_ERROR.RAW_REPL_STDOUT_TIMEOUT) {
        if (onOut) onOut("\n[Detenido]\n");
        try {
          await this.protocol.exitRawRepl();
        } catch {
          /* cleanup */
        }
        return { stdout: "", stderr: "", interrupted: true };
      }
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* cleanup */
      }
      throw e;
    }

    const stderr = result.stderr || "";
    const interrupted =
      this._interrupted && /KeyboardInterrupt/.test(stderr);
    if (interrupted) {
      if (onOut) onOut("\n[Detenido]\n");
    } else if (stderr.trim()) {
      if (onErr) onErr(stderr);
    }

    try {
      await this.protocol.exitRawRepl();
    } catch {
      /* cleanup */
    }
    return { stdout: result.stdout, stderr, interrupted };
  }

  /**
   * Código utilitario en raw REPL (sin wrapper educativo).
   * @param {string} code
   * @param {{timeout?:number}} options
   */
  async execRaw(code, options = {}) {
    if (!this._running) throw protocolError(PROTOCOL_ERROR.CLOSED);
    const timeout = options.timeout ?? 15000;
    await this.protocol.enterRawRepl();
    try {
      await this._execProgramBytes(String(code ?? "") + "\n");
      const result = await this.protocol.followExecution({
        stdoutTimeout: timeout,
        stderrTimeout: Math.min(timeout, RAW_REPL_STDERR_TIMEOUT_MS),
      });
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* cleanup */
      }
      return result;
    } catch (e) {
      try {
        await this.protocol.exitRawRepl();
      } catch {
        /* cleanup */
      }
      throw e;
    }
  }

  async interruptAndRecoverRepl() {
    try {
      await this.protocol.interruptExecution();
    } catch {
      /* ignore: recovering a stuck board */
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
    const code = ["import os", `print(os.stat('${safe}')[6])`].join("\n");
    const { stdout } = await this.execRaw(code, { timeout: 8000 });
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const n = parseInt(lines[lines.length - 1], 10);
    return Number.isNaN(n) ? -1 : n;
  }

  /**
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

  async hardwareReset() {
    const port = this.port;
    if (!port || typeof port.setSignals !== "function") return false;
    const release = async () => {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    };
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(100);
      await release();
      await sleep(1600);
      return true;
    } catch {
      try {
        await release();
      } catch {
        /* ignore: best-effort EN release */
      }
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

  async softReset() {
    await this.syncFilesystem();
    if (await this.hardwareReset()) {
      this._running = false;
      return;
    }
    let resetSent = false;
    try {
      await this._enterRawRepl();
      this.protocol.queue.clear();
      await this._write("import machine\nmachine.reset()\n");
      await this._write("\x04");
      resetSent = true;
    } catch {
      /* la placa ya se reinició o el puerto se cerró tras enviar el reset */
    }
    this._running = false;
    if (!resetSent) throw new Error("RESET_FAIL");
  }

  /**
   * Un solo Ctrl+C. En BLE nativo usa el plano ADMIN urgente; en USB conserva
   * exactamente el Ctrl+C del protocolo raw REPL existente.
   */
  async interrupt() {
    this._interrupted = true;
    if (this.transport && typeof this.transport.interruptUrgent === "function") {
      await this.transport.interruptUrgent();
      return;
    }
    await this.protocol.interruptExecution();
  }

  async close() {
    this._running = false;
    try {
      this.protocol.detach();
    } catch {
      /* cleanup */
    }
    if (this.transport && typeof this.transport.close === "function") {
      try {
        await this.transport.close();
      } catch {
        /* ignore: already closed */
      }
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
      /* ignore: port may already be closed */
    }
  }

  try {
    await port.open({ baudRate });
  } catch {
    throw new Error("BUSY");
  }

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const transport = new SerialByteTransport(port, writer, reader, baudRate);
  const session = new MicroPythonSession(transport);

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

/**
 * Adjunta una MicroPythonSession a un transporte ya conectado (BLE REPL).
 * Fallo de handshake → error estructurado, NUNCA NEEDS_PREP.
 */
export async function connectMicroPythonFromTransport(transport, options = {}) {
  const baudRate = options.baudRate ?? DEFAULT_BAUD;
  const session = new MicroPythonSession(transport);
  if (options.detect !== false) {
    let ok = false;
    try {
      ok = await session.detect();
    } catch (e) {
      try {
        await session.close();
      } catch {
        /* cleanup */
      }
      const code = errorCode(e);
      if (code === PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT) {
        throw protocolError(PROTOCOL_ERROR.BLE_REPL_HANDSHAKE_FAIL, { cause: e });
      }
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_HANDSHAKE_FAIL, {
        detail: code,
        cause: e,
      });
    }
    if (!ok) {
      try {
        await session.close();
      } catch {
        /* cleanup */
      }
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_HANDSHAKE_FAIL);
    }
  }
  if (options.recoverRepl) {
    await session.interruptAndRecoverRepl();
  }
  return { session, baudRate, mode: options.mode ?? "esp32-micropython" };
}
