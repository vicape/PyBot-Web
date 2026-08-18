/**
 * Reliable BLE byte transport under the MicroPython raw REPL.
 *
 * BluetoothTransport = physical GATT.
 * ReliableBleTransport = frames, seq, CRC, ACK/NACK, window, retry.
 * BleReplTransport = thin ByteTransport over the reconstructed stream.
 *
 * Framing is binary (reliable-repl-v1). Not JSON. MicroPythonSession still
 * sees a plain byte stream.
 *
 * Window=2: default ATT MTU 23 → 20-byte notify; header+CRC = 6 bytes →
 * 14-byte payload. NimBLE queues few notifies; 2 in-flight frames ≈ 40 bytes
 * RAM and matches controller buffers better than window=4.
 */

import { BLE_STATE } from "./bluetoothTransport.js";

export const RBLE_VERSION = 1;
export const RBLE_TYPE_DATA = 0x01;
export const RBLE_TYPE_ACK = 0x02;
export const RBLE_TYPE_NACK = 0x03;
export const RBLE_TYPE_RESET = 0x04;
export const RBLE_WINDOW = 2;
export const RBLE_MAX_PAYLOAD = 14;
export const RBLE_HEADER_SIZE = 4;
export const RBLE_CRC_SIZE = 2;
export const RBLE_FRAME_MAX = 20;
export const RBLE_ACK_TIMEOUT_MS = 120;
export const RBLE_RETRY_MAX = 10;
export const RBLE_CAPABILITY = "reliable-repl-v1";

/** CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, xorout 0. */
export function crc16(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function seqMasked(n) {
  return n & 0xffff;
}

export function seqLte(a, b) {
  return ((seqMasked(b) - seqMasked(a)) & 0xffff) < 0x8000;
}

export function seqLt(a, b) {
  return seqMasked(a) !== seqMasked(b) && seqLte(a, b);
}

/**
 * Frame: hdr(ver<<4|type), seq_hi, seq_lo, len, payload[len], crc_hi, crc_lo.
 * @param {number} type
 * @param {number} seq
 * @param {Uint8Array|number[]} [payload]
 */
export function encodeFrame(type, seq, payload = new Uint8Array(0)) {
  const src = payload instanceof Uint8Array ? payload : new Uint8Array(payload ?? []);
  const n = src.length > RBLE_MAX_PAYLOAD ? RBLE_MAX_PAYLOAD : src.length;
  const body = new Uint8Array(RBLE_HEADER_SIZE + n);
  body[0] = ((RBLE_VERSION & 0x0f) << 4) | (type & 0x0f);
  body[1] = (seq >>> 8) & 0xff;
  body[2] = seq & 0xff;
  body[3] = n;
  if (n) body.set(src.subarray(0, n), RBLE_HEADER_SIZE);
  const c = crc16(body);
  const out = new Uint8Array(body.length + RBLE_CRC_SIZE);
  out.set(body, 0);
  out[body.length] = (c >>> 8) & 0xff;
  out[body.length + 1] = c & 0xff;
  return out;
}

/**
 * @param {Uint8Array|number[]} data
 * @returns {null | { type:number, seq:number, payload:Uint8Array }}
 */
export function decodeFrame(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  if (bytes.length < RBLE_HEADER_SIZE + RBLE_CRC_SIZE) return null;
  const n = bytes[3];
  if (n > RBLE_MAX_PAYLOAD || bytes.length !== RBLE_HEADER_SIZE + n + RBLE_CRC_SIZE) {
    return null;
  }
  const body = bytes.subarray(0, RBLE_HEADER_SIZE + n);
  const got = (bytes[RBLE_HEADER_SIZE + n] << 8) | bytes[RBLE_HEADER_SIZE + n + 1];
  if (crc16(body) !== got) return null;
  if (bytes[0] >> 4 !== RBLE_VERSION) return null;
  return {
    type: bytes[0] & 0x0f,
    seq: (bytes[1] << 8) | bytes[2],
    payload: n ? bytes.slice(RBLE_HEADER_SIZE, RBLE_HEADER_SIZE + n) : new Uint8Array(0),
  };
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Same GATT surface as BluetoothTransport REPL (writeRepl / onReplData / …)
 * but delivers reconstructed payloads once, in order.
 */
export class ReliableBleTransport {
  /**
   * @param {import("./bluetoothTransport.js").BluetoothTransport} bluetooth
   * @param {{
   *   now?: () => number,
   *   setTimeout?: (fn: Function, ms: number) => any,
   *   clearTimeout?: (id: any) => void,
   *   ackTimeoutMs?: number,
   * }} [deps]
   */
  constructor(bluetooth, deps = {}) {
    this._bt = bluetooth;
    this._now = deps.now || (() => Date.now());
    this._setTimeout = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = deps.clearTimeout || ((id) => clearTimeout(id));
    this._ackTimeoutMs = deps.ackTimeoutMs ?? RBLE_ACK_TIMEOUT_MS;

    this._cbs = new Set();
    this._txNext = 0;
    this._txBase = 0;
    this._rxExpected = 0;
    this._window = []; // { seq, frame, notified, retries, sentAt }
    this._epoch = 0;
    this._peerEpoch = -1;
    this._synced = false;
    this._closed = false;
    this._txQueue = [];
    this._ackWaiters = [];
    this._timer = null;
    this._writeTail = Promise.resolve();
    this._started = false;
    this._ready = Promise.resolve();

    this._offData =
      typeof bluetooth.onReplData === "function"
        ? bluetooth.onReplData((bytes) => this._onRaw(bytes))
        : null;
    this._offState =
      typeof bluetooth.onStateChange === "function"
        ? bluetooth.onStateChange((state) => {
            if (state === BLE_STATE.DISCONNECTED || state === BLE_STATE.IDLE) {
              this.reset("disconnect");
            }
          })
        : null;

    if (deps.autoStart !== false) this._ready = this.start();
  }

  async start() {
    this._started = true;
    this._ready = this._resync();
    return this._ready;
  }

  isConnected() {
    try {
      return !!this._bt && this._bt.isConnected() && !this._closed;
    } catch {
      return false;
    }
  }

  hasRepl() {
    try {
      return !!this._bt?.hasRepl?.();
    } catch {
      return false;
    }
  }

  getReplStatus() {
    return typeof this._bt.getReplStatus === "function"
      ? this._bt.getReplStatus()
      : { rx: this.hasRepl(), tx: this.hasRepl(), notifications: this.hasRepl(), bindError: null };
  }

  /** Reconstructed REPL payload callbacks. */
  onReplData(cb) {
    if (typeof cb === "function") this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  async writeRepl(data) {
    const run = this._writeTail.then(() => this._writeNow(data));
    this._writeTail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async _writeNow(data) {
    await this._ready;
    if (!this.isConnected()) throw new Error("BLE_REPL_NOT_CONNECTED");
    const bytes =
      data instanceof Uint8Array ? data : typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (!bytes.length) return;
    for (let i = 0; i < bytes.length; i += RBLE_MAX_PAYLOAD) {
      this._txQueue.push(bytes.subarray(i, i + RBLE_MAX_PAYLOAD));
    }
    await this._pump();
  }

  async _resync() {
    this.reset("resync-local");
    this._epoch = (this._epoch + 1) & 0xff;
    this._synced = false;
    await this._sendCtrl(encodeFrame(RBLE_TYPE_RESET, 0, new Uint8Array([RBLE_WINDOW, this._epoch])));
  }

  reset(reason = "reset") {
    this._clearTimer();
    this._window = [];
    this._txNext = 0;
    this._txBase = 0;
    this._rxExpected = 0;
    this._txQueue = [];
    this._synced = false;
    const waiters = this._ackWaiters.splice(0);
    for (const w of waiters) {
      try {
        w.reject?.(new Error("RBLE_RESET:" + reason));
      } catch {
        /* ignore */
      }
    }
  }

  _emit(payload) {
    if (!payload || !payload.length) return;
    this._cbs.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* listener errors must not break dispatch */
      }
    });
  }

  _onRaw(bytes) {
    const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const parsed = decodeFrame(chunk);
    if (!parsed) {
      if (this._synced) void this._sendCtrl(encodeFrame(RBLE_TYPE_NACK, this._rxExpected, new Uint8Array(0)));
      return;
    }
    if (parsed.type === RBLE_TYPE_RESET) {
      const window = parsed.payload[0] ?? RBLE_WINDOW;
      const epoch = parsed.payload[1] ?? 0;
      this._onReset(window, epoch);
      return;
    }
    if (parsed.type === RBLE_TYPE_ACK) {
      this._onAck(parsed.seq);
      return;
    }
    if (parsed.type === RBLE_TYPE_NACK) {
      this._onNack(parsed.seq);
      return;
    }
    if (parsed.type !== RBLE_TYPE_DATA) return;
    if (!this._synced) return;
    if (parsed.seq === this._rxExpected) {
      this._rxExpected = seqMasked(this._rxExpected + 1);
      this._emit(parsed.payload);
      void this._sendCtrl(encodeFrame(RBLE_TYPE_ACK, parsed.seq, new Uint8Array(0)));
      return;
    }
    if (seqLt(parsed.seq, this._rxExpected)) {
      const last = seqMasked(this._rxExpected - 1);
      void this._sendCtrl(encodeFrame(RBLE_TYPE_ACK, last, new Uint8Array(0)));
      return;
    }
    void this._sendCtrl(encodeFrame(RBLE_TYPE_NACK, this._rxExpected, new Uint8Array(0)));
  }

  _onReset(_window, epoch) {
    const same = epoch === this._peerEpoch;
    this._peerEpoch = epoch;
    this._synced = true;
    if (same) {
      this._wakeAck();
      return;
    }
    this._clearTimer();
    this._window = [];
    this._txNext = 0;
    this._txBase = 0;
    this._rxExpected = 0;
    this._wakeAck();
    void this._sendCtrl(encodeFrame(RBLE_TYPE_RESET, 0, new Uint8Array([RBLE_WINDOW, this._epoch])));
  }

  _onAck(seq) {
    this._window = this._window.filter((slot) => !seqLte(slot.seq, seq));
    const nxt = seqMasked(seq + 1);
    if (seqLte(this._txBase, nxt)) this._txBase = nxt;
    this._armTimer();
    this._wakeAck();
  }

  _onNack(seq) {
    const slot = this._window.find((s) => s.seq === seq);
    if (slot) {
      slot.notified = false;
      void this._flushWindow();
    }
  }

  _wakeAck() {
    const waiters = this._ackWaiters.splice(0);
    for (const w of waiters) {
      try {
        w.resolve?.();
      } catch {
        /* ignore */
      }
    }
  }

  _waitWindow() {
    if (this._window.length < RBLE_WINDOW) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wrap = {
        resolve: () => {
          if (this._window.length < RBLE_WINDOW) resolve();
          else this._ackWaiters.push(wrap);
        },
        reject,
      };
      this._ackWaiters.push(wrap);
      if (this._window.length < RBLE_WINDOW) wrap.resolve();
    });
  }

  async _pump() {
    while (this._txQueue.length && this._window.length < RBLE_WINDOW) {
      const payload = this._txQueue.shift();
      const seq = this._txNext;
      this._txNext = seqMasked(seq + 1);
      const frame = encodeFrame(RBLE_TYPE_DATA, seq, payload);
      this._window.push({ seq, frame, notified: false, retries: 0, sentAt: 0 });
    }
    await this._flushWindow();
    while (this._txQueue.length) {
      await this._waitWindow();
      if (this._closed) throw new Error("BLE_REPL_NOT_CONNECTED");
      while (this._txQueue.length && this._window.length < RBLE_WINDOW) {
        const payload = this._txQueue.shift();
        const seq = this._txNext;
        this._txNext = seqMasked(seq + 1);
        const frame = encodeFrame(RBLE_TYPE_DATA, seq, payload);
        this._window.push({ seq, frame, notified: false, retries: 0, sentAt: 0 });
      }
      await this._flushWindow();
    }
    await this._waitWindowUntilIdle();
  }

  _waitWindowUntilIdle() {
    if (!this._window.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wrap = {
        resolve: () => {
          if (!this._window.length) resolve();
          else this._ackWaiters.push(wrap);
        },
        reject,
      };
      this._ackWaiters.push(wrap);
      if (!this._window.length) wrap.resolve();
    });
  }

  async _flushWindow() {
    if (typeof this._bt.writeRepl !== "function") throw new Error("BLE_REPL_TX_FAIL");
    for (const slot of this._window) {
      if (slot.notified) continue;
      await this._bt.writeRepl(slot.frame, RBLE_FRAME_MAX);
      slot.notified = true;
      slot.sentAt = this._now();
      slot.retries += 1;
    }
    this._armTimer();
  }

  async _sendCtrl(frame) {
    if (typeof this._bt.writeRepl !== "function") return;
    try {
      await this._bt.writeRepl(frame, RBLE_FRAME_MAX);
    } catch {
      /* control frames retry on next DATA/timeout path */
    }
  }

  _armTimer() {
    this._clearTimer();
    const waiting = this._window.some((s) => s.notified);
    if (!waiting) return;
    this._timer = this._setTimeout(() => {
      this._timer = null;
      void this._onAckTimeout();
    }, this._ackTimeoutMs);
    if (this._timer && typeof this._timer.unref === "function") this._timer.unref();
  }

  _clearTimer() {
    if (this._timer != null) {
      try {
        this._clearTimeout(this._timer);
      } catch {
        /* ignore */
      }
      this._timer = null;
    }
  }

  async _onAckTimeout() {
    if (!this._window.length) return;
    const oldest = this._window.reduce((a, b) => (seqLt(a.seq, b.seq) ? a : b));
    if (!oldest) return;
    if (oldest.retries >= RBLE_RETRY_MAX) {
      await this._resync();
      return;
    }
    oldest.notified = false;
    try {
      await this._flushWindow();
    } catch {
      this._armTimer();
    }
  }

  async close() {
    this._closed = true;
    this.reset("close");
    if (this._offData) {
      try {
        this._offData();
      } catch {
        /* ignore */
      }
      this._offData = null;
    }
    if (this._offState) {
      try {
        this._offState();
      } catch {
        /* ignore */
      }
      this._offState = null;
    }
    this._cbs.clear();
  }
}

export function splitPayloads(bytes, max = RBLE_MAX_PAYLOAD) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const out = [];
  for (let i = 0; i < src.length; i += max) out.push(src.subarray(i, i + max));
  return out;
}

export { concatBytes };
