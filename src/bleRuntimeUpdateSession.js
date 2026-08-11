/**
 * BleRuntimeUpdateSession: actualizacion OTA del PROPIO runtime de la ESP32
 * (main.py) por BLE (protocolo UPDATE 3.1). Canal ADMINISTRATIVO: NO es una
 * funcion educativa (no hay updateRuntime() para el alumno); la orquesta el
 * bridge/UI.
 *
 * Flujo:
 *   UPDATE:BEGIN:<version>:<size>:<hash> -> UPDATE:READY ->
 *   (UPDATE:CHUNK:<b64> -> UPDATE:ACK:<n>)* -> UPDATE:END ->
 *   UPDATE:VERIFY:OK -> UPDATE:APPLY -> (UPDATE:APPLYING; la placa RESETEA).
 *
 * Seguridad e integridad:
 *   - El firmware NUNCA sobrescribe main.py durante la transferencia: descarga a
 *     pybot_runtime.new y boot.py hace el swap con backup + rollback.
 *   - El hash SHA-256 (JS puro, identico a uhashlib) garantiza que lo recibido en
 *     la placa sea EXACTAMENTE lo enviado; sin coincidencia -> no hay VERIFY:OK.
 *   - `onProgress(percent)` se basa en bytes CONFIRMADOS por ACK (no en bytes
 *     enviados sin confirmar): el porcentaje refleja avance REAL, no optimista.
 *
 * Timeouts PROPIOS del update (no se reutilizan los de RUN): READY / ACK / VERIFY
 * / APPLY. La reconexion tras el reset (RECONNECT) la maneja el bridge.
 * Reutiliza `BluetoothTransport` (sendChunked/onData/onStateChange) SIN modificarlo
 * mas alla de agregar `reconnect()`. Sin listeners/timers huerfanos (finally).
 */

import {
  UPDATE,
  MAX_RUNTIME_UPDATE_SIZE,
  UPDATE_SOURCE_CHUNK,
  buildUpdateBegin,
  buildUpdateChunk,
  chunkRuntimeUpdate,
  parseUpdateFrame,
  sha256HexUtf8,
} from "./bleProtocol.js";

export const UPDATE_READY_TIMEOUT_MS = 8000;
export const UPDATE_ACK_TIMEOUT_MS = 8000;
export const UPDATE_VERIFY_TIMEOUT_MS = 15000;
export const UPDATE_APPLY_TIMEOUT_MS = 6000;
export const UPDATE_RECONNECT_TIMEOUT_MS = 20000;

export class BleRuntimeUpdateSession {
  /** @param {{ isConnected:Function, onData:Function, sendChunked:Function, onStateChange?:Function }} transport */
  constructor(transport) {
    this._tr = transport;
    this._busy = false;
  }

  isConnected() {
    try {
      return !!this._tr && this._tr.isConnected();
    } catch {
      return false;
    }
  }

  isBusy() {
    return this._busy;
  }

  /**
   * Transfiere, verifica y aplica un runtime nuevo. Al aplicar, la placa se
   * resetea (el GATT se cae): la reconexion + verificacion por INFO la hace quien
   * llama (bridge). NO declara exito por VERIFY: solo transfiere/verifica/aplica.
   *
   * @param {string} source fuente del runtime nuevo (main.py como texto)
   * @param {{ version:string, onProgress?:Function }} opts
   * @returns {Promise<{ ok:true, size:number, hash:string, version:string }>}
   */
  async update(source, opts = {}) {
    if (!this.isConnected()) throw new Error("BLE_NOT_CONNECTED");
    if (this._busy) throw new Error("BLE_UPDATE_BUSY");

    const version = String(opts.version ?? "").trim();
    if (!version) throw new Error("BLE_UPDATE_NO_VERSION");
    const onProgress = opts.onProgress ?? (() => {});

    const src = String(source ?? "");
    const bytes = new TextEncoder().encode(src);
    if (bytes.length === 0) throw new Error("BLE_UPDATE_EMPTY");
    if (bytes.length > MAX_RUNTIME_UPDATE_SIZE) throw new Error("BLE_UPDATE_TOO_LONG");
    const hash = sha256HexUtf8(src);

    this._busy = true;

    const frames = [];
    let disconnected = false;
    let pending = null; // { resolve, reject, timer }

    const deliver = () => {
      if (!pending) return;
      if (frames.length) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        p.resolve(frames.shift());
      } else if (disconnected) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        p.reject(new Error("BLE_UPDATE_DISCONNECTED"));
      }
    };

    const offData = this._tr.onData((raw) => {
      const f = parseUpdateFrame(raw);
      if (f.type === "unknown") return; // ignora frames RUN/APP/DEPLOY/PONG
      frames.push(f);
      deliver();
    });
    let offState = null;
    if (typeof this._tr.onStateChange === "function") {
      offState = this._tr.onStateChange((s) => {
        if (s === "disconnected" || s === "idle") {
          disconnected = true;
          deliver();
        }
      });
    }

    const nextFrame = (timeoutMs, label) =>
      new Promise((resolve, reject) => {
        pending = {
          resolve,
          reject,
          timer: setTimeout(() => {
            if (pending) {
              pending = null;
              reject(new Error("BLE_UPDATE_TIMEOUT:" + label));
            }
          }, timeoutMs),
        };
        deliver();
      });

    try {
      await this._tr.sendChunked(buildUpdateBegin(version, bytes.length, hash));
      const ready = await nextFrame(UPDATE_READY_TIMEOUT_MS, "ready");
      if (ready.type === "error") throw new Error("BLE_UPDATE_ERROR:" + ready.code);
      if (ready.type !== "ready") throw new Error("BLE_UPDATE_ERROR:UNEXPECTED");

      const chunks = chunkRuntimeUpdate(src);
      let confirmed = 0; // bytes de fuente CONFIRMADOS por ACK
      onProgress({ phase: "begin", sent: 0, total: bytes.length, pct: 0 });
      for (let i = 0; i < chunks.length; i++) {
        await this._tr.sendChunked(buildUpdateChunk(chunks[i]));
        const ack = await nextFrame(UPDATE_ACK_TIMEOUT_MS, "ack");
        if (ack.type === "error") throw new Error("BLE_UPDATE_ERROR:" + ack.code);
        if (ack.type !== "ack" || ack.index !== i) {
          throw new Error("BLE_UPDATE_ERROR:BAD_ACK");
        }
        // Bytes de fuente de ESTE bloque (el ultimo puede ser menor).
        const chunkBytes = Math.min(
          UPDATE_SOURCE_CHUNK,
          bytes.length - i * UPDATE_SOURCE_CHUNK,
        );
        confirmed += chunkBytes > 0 ? chunkBytes : 0;
        onProgress({
          phase: "transfer",
          sent: confirmed,
          total: bytes.length,
          pct: Math.round((confirmed / bytes.length) * 100),
        });
      }

      await this._tr.sendChunked(UPDATE.END);
      const verify = await nextFrame(UPDATE_VERIFY_TIMEOUT_MS, "verify");
      if (verify.type === "error") throw new Error("BLE_UPDATE_ERROR:" + verify.code);
      if (verify.type !== "verify_ok") throw new Error("BLE_UPDATE_ERROR:UNEXPECTED");
      onProgress({ phase: "verified", sent: bytes.length, total: bytes.length, pct: 100 });

      // APPLY: la placa escribe el estado pendiente y RESETEA. Esperamos el
      // UPDATE:APPLYING (o la desconexion por el reset). Un error aca (p.ej.
      // BAD_FRAME) SI es terminal; un timeout/desconexion es ESPERADO (reset).
      onProgress({ phase: "applying", sent: bytes.length, total: bytes.length, pct: 100 });
      await this._tr.sendChunked(UPDATE.APPLY);
      try {
        const applied = await nextFrame(UPDATE_APPLY_TIMEOUT_MS, "apply");
        if (applied.type === "error") {
          throw new Error("BLE_UPDATE_ERROR:" + applied.code);
        }
        // applied.type === "applying": la placa confirmo que va a resetear.
      } catch (e) {
        // Un error de protocolo del propio APPLY se propaga; el timeout o la
        // desconexion tras enviar APPLY son la señal ESPERADA del reset.
        const msg = e?.message ?? "";
        if (msg.startsWith("BLE_UPDATE_ERROR:")) throw e;
      }

      return { ok: true, size: bytes.length, hash, version };
    } catch (e) {
      // Best-effort: pedir que aborte y borre el .new (main.py intacto). Si ya
      // estamos desconectados, el firmware aborto solo en on_disconnect.
      try {
        await this._tr.sendChunked(UPDATE.ABORT);
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
      if (offData) offData();
      if (offState) offState();
      this._busy = false;
    }
  }
}
