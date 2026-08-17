/**
 * Cola binaria del REPL. El protocolo es de bytes, no de texto.
 * TextDecoder no se usa aquí.
 */

import { protocolError, PROTOCOL_ERROR } from "./errors.js";

function toU8(data) {
  if (data instanceof Uint8Array) return data;
  if (data == null) return new Uint8Array(0);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(data);
}

function toSeq(sequence) {
  if (sequence instanceof Uint8Array) return sequence;
  if (typeof sequence === "number") return new Uint8Array([sequence & 0xff]);
  if (typeof sequence === "string") return new TextEncoder().encode(sequence);
  return new Uint8Array(sequence);
}

/** Índice de `seq` en `buf`, o -1. */
export function indexOfBytes(buf, seq, from = 0) {
  const n = buf.length;
  const m = seq.length;
  if (m === 0) return from;
  if (m > n - from) return -1;
  outer: for (let i = from; i <= n - m; i++) {
    for (let j = 0; j < m; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function suffixPrefixLen(buf, seq) {
  const max = Math.min(buf.length, seq.length - 1);
  for (let hold = max; hold > 0; hold--) {
    let ok = true;
    for (let i = 0; i < hold; i++) {
      if (buf[buf.length - hold + i] !== seq[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return hold;
  }
  return 0;
}

export class ByteQueue {
  constructor() {
    this._buf = new Uint8Array(0);
    this._waiters = new Set();
    this._closed = false;
    this._closeError = null;
  }

  get length() {
    return this._buf.length;
  }

  get closed() {
    return this._closed;
  }

  /**
   * @param {Uint8Array|ArrayBuffer|string|number[]} chunk
   */
  push(chunk) {
    if (this._closed) return;
    const u8 = toU8(chunk);
    if (!u8.length) return;
    const next = new Uint8Array(this._buf.length + u8.length);
    next.set(this._buf, 0);
    next.set(u8, this._buf.length);
    this._buf = next;
    this._notify();
  }

  /** Descarta todo lo buffered (p. ej. basura previa a Ctrl+A). */
  clear() {
    this._buf = new Uint8Array(0);
  }

  /**
   * @param {unknown} [err]
   */
  close(err) {
    if (this._closed) return;
    this._closed = true;
    this._closeError =
      err instanceof Error ? err : protocolError(PROTOCOL_ERROR.CLOSED, { detail: err });
    this._notify();
  }

  /** @param {number} n */
  peek(n) {
    const take = Math.max(0, Math.min(n, this._buf.length));
    return this._buf.slice(0, take);
  }

  /** @param {number} n */
  consume(n) {
    const take = Math.max(0, Math.min(n, this._buf.length));
    const out = this._buf.slice(0, take);
    this._buf = this._buf.slice(take);
    return out;
  }

  _notify() {
    const waiters = [...this._waiters];
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* waiter errors are not protocol errors */
      }
    }
  }

  _waitUntil(pred, timeoutMs, timeoutCode) {
    if (pred()) return Promise.resolve();
    if (this._closed) return Promise.reject(this._closeError);
    const finite = Number.isFinite(timeoutMs);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn) => {
        if (done) return;
        done = true;
        this._waiters.delete(check);
        if (timer) clearTimeout(timer);
        fn();
      };
      const check = () => {
        if (pred()) {
          finish(resolve);
          return;
        }
        if (this._closed) {
          finish(() => reject(this._closeError));
        }
      };
      this._waiters.add(check);
      const timer = finite
        ? setTimeout(() => {
            finish(() => reject(protocolError(timeoutCode || PROTOCOL_ERROR.CLOSED)));
          }, Math.max(0, timeoutMs))
        : null;
    });
  }

  /**
   * @param {number} n
   * @param {number} timeoutMs
   * @param {string} [timeoutCode]
   * @returns {Promise<Uint8Array>}
   */
  async readExact(n, timeoutMs, timeoutCode) {
    const want = n | 0;
    if (want <= 0) return new Uint8Array(0);
    await this._waitUntil(
      () => this._buf.length >= want,
      timeoutMs,
      timeoutCode || PROTOCOL_ERROR.CLOSED,
    );
    return this.consume(want);
  }

  /**
   * Espera a que haya al menos 1 byte.
   * @param {number} timeoutMs
   * @param {string} [timeoutCode]
   */
  async waitForByte(timeoutMs, timeoutCode) {
    await this._waitUntil(
      () => this._buf.length > 0,
      timeoutMs,
      timeoutCode || PROTOCOL_ERROR.CLOSED,
    );
    return this.peek(1)[0];
  }

  /**
   * Lee hasta `sequence` inclusive. Devuelve los bytes ANTES del delimitador
   * (el delimitador se consume y no se incluye).
   *
   * @param {Uint8Array|string|number} sequence
   * @param {number} timeoutMs
   * @param {string} timeoutCode
   * @param {{ onBytes?: (chunk: Uint8Array) => void }} [opts]
   * @returns {Promise<Uint8Array>}
   */
  async readUntil(sequence, timeoutMs, timeoutCode, opts = {}) {
    const seq = toSeq(sequence);
    const onBytes = typeof opts.onBytes === "function" ? opts.onBytes : null;
    const parts = [];
    const start = Date.now();
    const finite = Number.isFinite(timeoutMs);

    for (;;) {
      const idx = indexOfBytes(this._buf, seq);
      if (idx >= 0) {
        const before = this.consume(idx);
        this.consume(seq.length);
        if (before.length && onBytes) onBytes(before);
        parts.push(before);
        break;
      }
      if (this._buf.length) {
        const hold = suffixPrefixLen(this._buf, seq);
        const emitLen = this._buf.length - hold;
        if (emitLen > 0) {
          const chunk = this.consume(emitLen);
          if (onBytes) onBytes(chunk);
          parts.push(chunk);
        }
      }
      if (this._closed) throw this._closeError;
      const remaining = finite ? Math.max(0, timeoutMs - (Date.now() - start)) : timeoutMs;
      if (finite && remaining === 0) {
        throw protocolError(timeoutCode || PROTOCOL_ERROR.CLOSED);
      }
      await this._waitUntil(
        () => indexOfBytes(this._buf, seq) >= 0 || this._buf.length > suffixPrefixLen(this._buf, seq),
        remaining,
        timeoutCode || PROTOCOL_ERROR.CLOSED,
      );
    }

    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}
