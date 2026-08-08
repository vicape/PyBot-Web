/**
 * Capa aislada de Web Bluetooth (BLE) para PyBot.
 *
 * Encapsula toda la interaccion con `navigator.bluetooth` para que el resto de
 * la UI no dependa de la API BLE directamente. NO toca el sistema USB / Web
 * Serial existente: es un transporte independiente y opcional.
 *
 * API publica:
 *   connect(), disconnect(), send(data), isConnected(), onData(cb), getDeviceInfo()
 *
 * Conceptualmente implementa la misma interfaz que un futuro HardwareTransport
 * (connect/disconnect/send/onData/isConnected), sin reescribir el Serial actual.
 */

import {
  SERVICE_UUID,
  RX_UUID,
  TX_UUID,
  MSG_DELIMITER,
  splitMessages,
} from "./bleProtocol.js";

export const BLE_STATE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
});

/** @returns {boolean} true si el navegador soporta Web Bluetooth. */
export function isWebBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export class BluetoothTransport {
  /**
   * @param {{ bluetooth?: any, encoder?: TextEncoder, decoder?: TextDecoder }} [deps]
   *   Inyeccion opcional para tests (mock de navigator.bluetooth).
   */
  constructor(deps = {}) {
    this._bt =
      deps.bluetooth ??
      (typeof navigator !== "undefined" ? navigator.bluetooth : undefined);
    this._enc = deps.encoder ?? new TextEncoder();
    this._dec = deps.decoder ?? new TextDecoder();

    this._device = null;
    this._server = null;
    this._service = null;
    this._rxChar = null; // WRITE (Web -> ESP32)
    this._txChar = null; // NOTIFY (ESP32 -> Web)
    this._state = BLE_STATE.IDLE;
    this._rxBuffer = "";
    this._dataCallbacks = new Set();
    this._stateCallbacks = new Set();
    this._deviceInfo = null;

    this._onTxValueChanged = this._onTxValueChanged.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  /** @returns {string} estado actual (BLE_STATE). */
  get state() {
    return this._state;
  }

  isConnected() {
    return this._state === BLE_STATE.CONNECTED && !!this._server?.connected;
  }

  /** Registra callback para mensajes de texto completos recibidos. @returns {() => void} */
  onData(cb) {
    if (typeof cb === "function") this._dataCallbacks.add(cb);
    return () => this._dataCallbacks.delete(cb);
  }

  /** Registra callback para cambios de estado. @returns {() => void} */
  onStateChange(cb) {
    if (typeof cb === "function") this._stateCallbacks.add(cb);
    return () => this._stateCallbacks.delete(cb);
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this._stateCallbacks.forEach((cb) => {
      try {
        cb(state);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Solicita el dispositivo (filtrando por SERVICE UUID), conecta GATT y
   * suscribe notificaciones TX.
   * @returns {Promise<{ deviceName: string|null }>}
   * @throws {Error} "BLE_UNSUPPORTED" | "BLE_CANCELLED" | "BLE_CONNECT_FAIL"
   */
  async connect() {
    if (!this._bt) throw new Error("BLE_UNSUPPORTED");
    this._setState(BLE_STATE.CONNECTING);
    try {
      this._device = await this._bt.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
    } catch (e) {
      this._setState(BLE_STATE.IDLE);
      const name = e?.name ?? "";
      if (name === "NotFoundError") throw new Error("BLE_CANCELLED");
      throw new Error("BLE_CONNECT_FAIL");
    }

    try {
      this._device.addEventListener("gattserverdisconnected", this._onDisconnected);
      this._server = await this._device.gatt.connect();
      this._service = await this._server.getPrimaryService(SERVICE_UUID);
      this._rxChar = await this._service.getCharacteristic(RX_UUID);
      this._txChar = await this._service.getCharacteristic(TX_UUID);
      await this._txChar.startNotifications();
      this._txChar.addEventListener(
        "characteristicvaluechanged",
        this._onTxValueChanged,
      );
      this._rxBuffer = "";
      this._setState(BLE_STATE.CONNECTED);
      return { deviceName: this._device?.name ?? null };
    } catch {
      await this._cleanup();
      this._setState(BLE_STATE.DISCONNECTED);
      throw new Error("BLE_CONNECT_FAIL");
    }
  }

  _onTxValueChanged(event) {
    const value = event?.target?.value;
    if (!value) return;
    let text;
    try {
      text = this._dec.decode(value);
    } catch {
      return;
    }
    this._rxBuffer += text;
    const { messages, rest } = splitMessages(this._rxBuffer);
    this._rxBuffer = rest;
    messages.forEach((msg) => this._emitData(msg));
  }

  _emitData(message) {
    this._dataCallbacks.forEach((cb) => {
      try {
        cb(message);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Envia un comando de texto por la caracteristica RX (WRITE).
   * @param {string} data
   */
  async send(data) {
    if (!this.isConnected() || !this._rxChar) {
      throw new Error("BLE_NOT_CONNECTED");
    }
    const payload = String(data ?? "");
    const withDelim = payload.endsWith(MSG_DELIMITER) ? payload : payload + MSG_DELIMITER;
    const bytes = this._enc.encode(withDelim);
    if (typeof this._rxChar.writeValueWithoutResponse === "function") {
      await this._rxChar.writeValueWithoutResponse(bytes);
    } else {
      await this._rxChar.writeValue(bytes);
    }
  }

  /**
   * Envia un comando y espera la primera respuesta (con timeout).
   * @param {string} command
   * @param {number} [timeoutMs]
   * @returns {Promise<string>}
   */
  sendAndWait(command, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const off = this.onData((msg) => {
        if (done) return;
        done = true;
        off();
        resolve(msg);
      });
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(new Error("BLE_TIMEOUT"));
      }, timeoutMs);
      this.send(command).catch((e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        reject(e);
      });
    });
  }

  /**
   * Devuelve info del dispositivo (nombre BLE y, si se solicita INFO, mas datos).
   * @returns {{ deviceName: string|null, info: object|null }}
   */
  getDeviceInfo() {
    return {
      deviceName: this._device?.name ?? null,
      info: this._deviceInfo,
    };
  }

  /** Guarda el objeto INFO parseado (lo setea la UI tras consultar INFO). */
  setDeviceInfo(info) {
    this._deviceInfo = info ?? null;
  }

  _onDisconnected() {
    this._server = null;
    this._service = null;
    this._rxChar = null;
    this._txChar = null;
    this._rxBuffer = "";
    this._setState(BLE_STATE.DISCONNECTED);
  }

  async _cleanup() {
    if (this._txChar) {
      try {
        this._txChar.removeEventListener(
          "characteristicvaluechanged",
          this._onTxValueChanged,
        );
      } catch {
        /* ignore */
      }
      try {
        await this._txChar.stopNotifications();
      } catch {
        /* ignore */
      }
    }
    this._txChar = null;
    this._rxChar = null;
    this._service = null;
  }

  async disconnect() {
    await this._cleanup();
    if (this._device) {
      try {
        this._device.removeEventListener(
          "gattserverdisconnected",
          this._onDisconnected,
        );
      } catch {
        /* ignore */
      }
    }
    try {
      if (this._device?.gatt?.connected) this._device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    this._server = null;
    this._device = null;
    this._deviceInfo = null;
    this._rxBuffer = "";
    this._setState(BLE_STATE.IDLE);
  }
}
