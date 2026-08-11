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
   * Envia un mensaje de texto por RX partiendolo en escrituras GATT pequenas
   * (<= chunkBytes) para tolerar el MTU BLE por defecto (23 -> ~20 utiles),
   * independientemente del MTU negociado. El firmware reensambla por '\n'.
   *
   * Se usa para el protocolo de EJECUCION (frames RUN largos) y DEPLOY. NO cambia
   * el comportamiento de `send()` (comandos cortos PING/INFO/LED).
   *
   * Pacing/backpressure: entre fragmentos GATT se intercala una pausa minima
   * cuando se usa writeValueWithoutResponse (que no espera confirmacion del
   * peripheral) para no desbordar el buffer RX del ESP32 con el MTU por defecto.
   * @param {string} data
   * @param {number} [chunkBytes]
   * @param {number} [paceMs] pausa entre fragmentos (0 = sin pausa)
   */
  async sendChunked(data, chunkBytes = 20, paceMs = 4) {
    if (!this.isConnected() || !this._rxChar) {
      throw new Error("BLE_NOT_CONNECTED");
    }
    const payload = String(data ?? "");
    const withDelim = payload.endsWith(MSG_DELIMITER) ? payload : payload + MSG_DELIMITER;
    const bytes = this._enc.encode(withDelim);
    const size = chunkBytes > 0 ? chunkBytes : 20;
    const hasNoResponse = typeof this._rxChar.writeValueWithoutResponse === "function";
    let first = true;
    for (let i = 0; i < bytes.length; i += size) {
      const piece = bytes.slice(i, i + size);
      if (hasNoResponse) {
        // Sin respuesta: aplicar pacing para dar tiempo al reensamblado en placa.
        if (!first && paceMs > 0) {
          await new Promise((r) => setTimeout(r, paceMs));
        }
        await this._rxChar.writeValueWithoutResponse(piece);
      } else {
        // writeValue espera confirmacion: ya hay backpressure natural.
        await this._rxChar.writeValue(piece);
      }
      first = false;
    }
  }

  /**
   * Envia un comando y espera una respuesta (con timeout).
   * @param {string} command
   * @param {number} [timeoutMs]
   * @param {{ match?: (msg:string) => boolean }} [opts]
   *   Si `match` se define, ignora frames que no cumplan (evita que un
   *   RUN:READY/OUT robado por un INFO concurrente tumbe el handshake).
   * @returns {Promise<string>}
   */
  sendAndWait(command, timeoutMs = 4000, opts = {}) {
    const match = typeof opts.match === "function" ? opts.match : null;
    return new Promise((resolve, reject) => {
      let done = false;
      const off = this.onData((msg) => {
        if (done) return;
        if (match && !match(String(msg ?? ""))) return;
        done = true;
        clearTimeout(timer);
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
   * Reconecta al MISMO `BluetoothDevice` ya autorizado, SIN volver a mostrar el
   * selector del navegador. Se usa tras una actualizacion OTA: al aplicar, la
   * placa se resetea y el GATT se cae; hay que esperar a que vuelva el advertising
   * y reconectar. Reintenta hasta `timeoutMs` porque el reinicio del ESP32 tarda.
   *
   * NO requiere un nuevo `requestDevice()` porque `this._device` se conserva tras
   * `gattserverdisconnected` (solo `disconnect()` lo descarta). Si el dispositivo
   * ya no esta (p.ej. se llamo `disconnect()`), lanza `BLE_NO_DEVICE`.
   *
   * @param {number} [timeoutMs] ventana total de reintentos.
   * @returns {Promise<{ deviceName: string|null }>}
   * @throws {Error} "BLE_NO_DEVICE" | "BLE_RECONNECT_FAIL"
   */
  async reconnect(timeoutMs = 20000) {
    if (!this._device) throw new Error("BLE_NO_DEVICE");
    this._setState(BLE_STATE.CONNECTING);
    const deadline = Date.now() + timeoutMs;
    let attempted = false;
    while (Date.now() < deadline) {
      // Espaciar reintentos (dar tiempo al ESP32 a reiniciar y anunciar).
      if (attempted) {
        await new Promise((r) => setTimeout(r, 700));
      }
      attempted = true;
      try {
        this._device.addEventListener(
          "gattserverdisconnected",
          this._onDisconnected,
        );
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
        // El INFO cacheado corresponde al runtime ANTERIOR: se releera tras
        // reconectar para verificar la nueva version.
        this._deviceInfo = null;
        this._setState(BLE_STATE.CONNECTED);
        return { deviceName: this._device?.name ?? null };
      } catch {
        await this._cleanup();
        /* reintento */
      }
    }
    this._setState(BLE_STATE.DISCONNECTED);
    throw new Error("BLE_RECONNECT_FAIL");
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
