/**
 * Transporte serial (Web Serial) hacia MicroPythonSession.
 * No conoce GPIO, EDA6, Wi-Fi ni el programa del alumno.
 */

import {
  SERIAL_WRITE_CHUNK,
  SERIAL_WRITE_PACE_MS,
} from "./constants.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class SerialByteTransport {
  /**
   * @param {SerialPort} port
   * @param {WritableStreamDefaultWriter} writer
   * @param {ReadableStreamDefaultReader} reader
   * @param {number} [baudRate]
   */
  constructor(port, writer, reader, baudRate) {
    this.port = port;
    this.writer = writer;
    this.reader = reader;
    this.baudRate = baudRate;
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this._cbs = new Set();
    this._running = true;
    this._readPromise = this._readLoop();
  }

  isOpen() {
    return this._running === true;
  }

  /** @param {(chunk: Uint8Array) => void} cb @returns {() => void} */
  onData(cb) {
    if (typeof cb === "function") this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  async write(data) {
    if (!this._running || !this.writer) throw new Error("closed");
    const bytes =
      typeof data === "string" ? this._enc.encode(data) : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
    const CH = SERIAL_WRITE_CHUNK;
    for (let i = 0; i < bytes.length; i += CH) {
      await this.writer.write(bytes.slice(i, i + CH));
      if (bytes.length > CH) await sleep(SERIAL_WRITE_PACE_MS);
    }
  }

  async _readLoop() {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done || !this._running) break;
        if (value && value.length) {
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
          this._cbs.forEach((cb) => {
            try {
              cb(chunk);
            } catch {
              /* ignore */
            }
          });
        }
      }
    } catch {
      /* cancel o cierre */
    }
  }

  async close() {
    this._running = false;
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
    this._cbs.clear();
  }
}
