/**
 * Transporte BLE REPL: ByteTransport (write / onData / close / isOpen).
 * No interpreta raw REPL. Cola de escritura: un solo write a la vez sobre REPL_RX.
 * El Stop urgente usa el plano ADMIN independiente y cancela writes aún no iniciados.
 */

import { REPL_RX_UUID, REPL_TX_UUID } from "../bleProtocol.js";
import { BLE_REPL_CHUNK } from "./constants.js";
import { protocolError, PROTOCOL_ERROR } from "./errors.js";

export class BleReplTransport {
  /**
   * @param {import("../bluetoothTransport.js").BluetoothTransport} bluetooth
   */
  constructor(bluetooth) {
    this._bt = bluetooth;
    this.port = null;
    this.baudRate = null;
    this._cbs = new Set();
    this._off = null;
    this._enc = new TextEncoder();
    this._writeTail = Promise.resolve();
    this._writeGeneration = 0;
    if (typeof bluetooth.onReplData === "function") {
      this._off = bluetooth.onReplData((bytes) => {
        const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this._cbs.forEach((cb) => {
          try {
            cb(chunk);
          } catch {
            /* listener errors must not break notify dispatch */
          }
        });
      });
    }
  }

  isOpen() {
    try {
      return !!this._bt && this._bt.isConnected() && this._bt.hasRepl?.();
    } catch {
      return false;
    }
  }

  /** @param {(chunk: Uint8Array) => void} cb @returns {() => void} */
  onData(cb) {
    if (typeof cb === "function") this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  /**
   * Stop de control: invalida writes normales todavía encolados y NO se encadena
   * a _writeTail. ReliableBleTransport completa solo su ventana ya secuenciada y
   * luego manda STOP por ADMIN.
   */
  async interruptUrgent() {
    if (!this.isOpen()) {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_NOT_CONNECTED);
    }
    if (typeof this._bt.interruptUrgent !== "function") {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_TX_FAIL, { detail: "urgent-stop-unsupported" });
    }
    this._writeGeneration += 1;
    try {
      await this._bt.interruptUrgent();
    } catch (e) {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_TX_FAIL, { cause: e });
    }
  }

  async write(data) {
    const generation = this._writeGeneration;
    const run = this._writeTail.then(() => {
      if (generation !== this._writeGeneration) return undefined;
      return this._writeNow(data);
    });
    this._writeTail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async _writeNow(data) {
    if (!this.isOpen()) {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_NOT_CONNECTED);
    }
    const bytes =
      typeof data === "string"
        ? this._enc.encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    if (typeof this._bt.writeRepl !== "function") {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_TX_FAIL, { detail: "unsupported" });
    }
    try {
      await this._bt.writeRepl(bytes, BLE_REPL_CHUNK);
    } catch (e) {
      throw protocolError(PROTOCOL_ERROR.BLE_REPL_TX_FAIL, { cause: e });
    }
  }

  async close() {
    this._writeGeneration += 1;
    if (this._off) {
      try {
        this._off();
      } catch {
        /* unsubscribe best-effort */
      }
      this._off = null;
    }
    this._cbs.clear();
  }
}

export { REPL_RX_UUID, REPL_TX_UUID };
