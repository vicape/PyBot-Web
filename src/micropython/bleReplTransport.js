/**
 * Transporte BLE REPL: bytes crudos hacia las características REPL_RX / REPL_TX.
 * No mezcla framing administrativo (PING/INFO/OTA) con el stream REPL.
 */

import { REPL_RX_UUID, REPL_TX_UUID } from "../bleProtocol.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    if (typeof bluetooth.onReplData === "function") {
      this._off = bluetooth.onReplData((bytes) => {
        this._cbs.forEach((cb) => {
          try {
            cb(bytes);
          } catch {
            /* ignore */
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

  async write(data) {
    if (!this.isOpen()) throw new Error("BLE_REPL_NOT_CONNECTED");
    const bytes =
      typeof data === "string" ? this._enc.encode(data) : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
    if (typeof this._bt.writeRepl === "function") {
      await this._bt.writeRepl(bytes);
      return;
    }
    throw new Error("BLE_REPL_UNSUPPORTED");
  }

  async close() {
    if (this._off) {
      try {
        this._off();
      } catch {
        /* ignore */
      }
      this._off = null;
    }
    this._cbs.clear();
  }
}

export { REPL_RX_UUID, REPL_TX_UUID };
