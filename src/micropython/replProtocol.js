/**
 * Protocolo oficial MicroPython raw REPL / raw-paste (v1.27.0, tools/pyboard.py).
 *
 * Operaciones:
 *   enterRawRepl, executeRawClassic, executeRawPaste, followExecution,
 *   interruptExecution, exitRawRepl
 *
 * USB y BLE usan esta misma clase. La única diferencia es ByteTransport.
 */

import { ByteQueue } from "./byteQueue.js";
import { protocolError, PROTOCOL_ERROR } from "./errors.js";
import {
  BYTE_CTRL_A,
  BYTE_CTRL_B,
  BYTE_CTRL_C,
  BYTE_CTRL_D,
  RAW_PASTE_HELLO,
  OK_BYTES,
  RAW_REPL_BANNER_TEXT,
  RAW_REPL_CLASSIC_CHUNK,
  RAW_REPL_ENTER_TIMEOUT_MS,
  RAW_REPL_ACK_TIMEOUT_MS,
  RAW_PASTE_HEADER_TIMEOUT_MS,
  RAW_PASTE_WINDOW_TIMEOUT_MS,
  RAW_PASTE_EOF_TIMEOUT_MS,
  RAW_REPL_STDOUT_TIMEOUT_MS,
  RAW_REPL_STDERR_TIMEOUT_MS,
} from "./constants.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return ENC.encode(data);
  if (data == null) return new Uint8Array(0);
  return new Uint8Array(data);
}

function u8eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class MicroPythonReplProtocol {
  /**
   * @param {{ write: Function, onData: Function, close?: Function, isOpen?: Function }} transport
   */
  constructor(transport) {
    this.transport = transport;
    this.queue = new ByteQueue();
    this._off = transport.onData((chunk) => {
      this.queue.push(chunk instanceof Uint8Array ? chunk : toBytes(chunk));
    });
  }

  async write(data) {
    await this.transport.write(toBytes(data));
  }

  /**
   * Ctrl+C, descartar basura previa, Ctrl+A, esperar el banner COMPLETO.
   * @param {{ timeout?: number }} [opts]
   */
  async enterRawRepl(opts = {}) {
    const timeout = opts.timeout ?? RAW_REPL_ENTER_TIMEOUT_MS;
    await this.write(new Uint8Array([BYTE_CTRL_C]));
    this.queue.clear();
    await this.write(new Uint8Array([BYTE_CTRL_A]));
    try {
      await this.queue.readUntil(
        RAW_REPL_BANNER_TEXT,
        timeout,
        PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT,
      );
    } catch (e) {
      if (e?.code === PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT) throw e;
      throw protocolError(PROTOCOL_ERROR.RAW_REPL_ENTER_TIMEOUT, { cause: e });
    }
  }

  /**
   * Raw REPL clásico: chunks + Ctrl+D + leer exactamente OK (0x4F 0x4B).
   * Conserva bytes posteriores en la cola para followExecution.
   * @param {Uint8Array|string} program
   */
  async executeRawClassic(program, opts = {}) {
    const bytes = toBytes(program);
    const chunk = opts.chunkSize ?? RAW_REPL_CLASSIC_CHUNK;
    for (let i = 0; i < bytes.length; i += chunk) {
      await this.write(bytes.subarray(i, i + Math.min(chunk, bytes.length - i)));
    }
    await this.write(new Uint8Array([BYTE_CTRL_D]));
    const ack = await this.queue.readExact(
      2,
      opts.ackTimeout ?? RAW_REPL_ACK_TIMEOUT_MS,
      PROTOCOL_ERROR.RAW_REPL_EXEC_ACK_BAD,
    );
    if (!u8eq(ack, OK_BYTES)) {
      const detail = Array.from(ack)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      throw protocolError(PROTOCOL_ERROR.RAW_REPL_EXEC_ACK_BAD, { detail });
    }
  }

  /**
   * Raw-paste oficial.
   * @param {Uint8Array|string} program
   * @returns {Promise<{ supported: boolean }>}
   */
  async executeRawPaste(program, opts = {}) {
    const bytes = toBytes(program);
    await this.write(RAW_PASTE_HELLO);
    let header;
    try {
      header = await this.queue.readExact(
        2,
        opts.headerTimeout ?? RAW_PASTE_HEADER_TIMEOUT_MS,
        PROTOCOL_ERROR.RAW_PASTE_HEADER_TIMEOUT,
      );
    } catch (e) {
      if (e?.code === PROTOCOL_ERROR.RAW_PASTE_HEADER_TIMEOUT) throw e;
      throw protocolError(PROTOCOL_ERROR.RAW_PASTE_HEADER_TIMEOUT, { cause: e });
    }
    if (header[0] === 0x52 && header[1] === 0x00) {
      return { supported: false };
    }
    if (header[0] !== 0x52 || header[1] !== 0x01) {
      const detail = Array.from(header)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      throw protocolError(PROTOCOL_ERROR.RAW_PASTE_HEADER_BAD, { detail });
    }

    const winBytes = await this.queue.readExact(
      2,
      opts.headerTimeout ?? RAW_PASTE_HEADER_TIMEOUT_MS,
      PROTOCOL_ERROR.RAW_PASTE_HEADER_TIMEOUT,
    );
    const windowSize = winBytes[0] | (winBytes[1] << 8);
    let windowRemaining = windowSize;
    const windowTimeout = opts.windowTimeout ?? RAW_PASTE_WINDOW_TIMEOUT_MS;
    let offset = 0;

    const consumeFlow = async (block) => {
      while (windowRemaining === 0 || this.queue.length > 0) {
        if (this.queue.length === 0) {
          if (!block) break;
          await this.queue.waitForByte(windowTimeout, PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT);
        }
        const b = await this.queue.readExact(1, windowTimeout, PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT);
        if (b[0] === BYTE_CTRL_A) {
          windowRemaining += windowSize;
        } else if (b[0] === BYTE_CTRL_D) {
          await this.write(new Uint8Array([BYTE_CTRL_D]));
          throw protocolError(PROTOCOL_ERROR.RAW_PASTE_ABORTED);
        } else {
          throw protocolError(PROTOCOL_ERROR.RAW_PASTE_HEADER_BAD, {
            detail: "flow " + b[0].toString(16),
          });
        }
      }
    };

    while (offset < bytes.length) {
      await consumeFlow(windowRemaining === 0);
      if (windowRemaining === 0) {
        throw protocolError(PROTOCOL_ERROR.RAW_PASTE_WINDOW_TIMEOUT);
      }
      const n = Math.min(windowRemaining, bytes.length - offset);
      await this.write(bytes.subarray(offset, offset + n));
      windowRemaining -= n;
      offset += n;
    }

    await this.write(new Uint8Array([BYTE_CTRL_D]));
    const eofTimeout = opts.eofTimeout ?? RAW_PASTE_EOF_TIMEOUT_MS;
    for (;;) {
      const b = await this.queue.readExact(1, eofTimeout, PROTOCOL_ERROR.RAW_PASTE_EOF_TIMEOUT);
      if (b[0] === BYTE_CTRL_A) continue;
      if (b[0] === BYTE_CTRL_D) break;
      throw protocolError(PROTOCOL_ERROR.RAW_PASTE_HEADER_BAD, {
        detail: "eof " + b[0].toString(16),
      });
    }
    return { supported: true };
  }

  /**
   * stdout hasta el primer Ctrl+D, stderr hasta el segundo. Luego UTF-8.
   * @param {{ onStdout?: (text: string) => void, stdoutTimeout?: number, stderrTimeout?: number }} [opts]
   */
  async followExecution(opts = {}) {
    const stdoutTimeout = opts.stdoutTimeout ?? RAW_REPL_STDOUT_TIMEOUT_MS;
    const stderrTimeout = opts.stderrTimeout ?? RAW_REPL_STDERR_TIMEOUT_MS;
    const onStdout = typeof opts.onStdout === "function" ? opts.onStdout : null;

    const stdoutRaw = await this.queue.readUntil(
      BYTE_CTRL_D,
      stdoutTimeout,
      PROTOCOL_ERROR.RAW_REPL_STDOUT_TIMEOUT,
      {
        onBytes: onStdout
          ? (chunk) => {
              if (chunk.length) onStdout(DEC.decode(chunk));
            }
          : null,
      },
    );
    const stderrRaw = await this.queue.readUntil(
      BYTE_CTRL_D,
      stderrTimeout,
      PROTOCOL_ERROR.RAW_REPL_STDERR_TIMEOUT,
    );
    return {
      stdout: DEC.decode(stdoutRaw),
      stderr: DEC.decode(stderrRaw),
    };
  }

  /** Un solo Ctrl+C. followExecution no envía otro. */
  async interruptExecution() {
    await this.write(new Uint8Array([BYTE_CTRL_C]));
  }

  async exitRawRepl() {
    await this.write(new Uint8Array([BYTE_CTRL_B]));
  }

  detach() {
    if (this._off) {
      try {
        this._off();
      } catch {
        /* unsubscribe best-effort */
      }
      this._off = null;
    }
    this.queue.close(protocolError(PROTOCOL_ERROR.CLOSED));
  }
}
