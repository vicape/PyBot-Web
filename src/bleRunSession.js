/**
 * BleRunSession: ejecuta el programa del alumno EN una ESP32 conectada por BLE,
 * hablando el protocolo de ejecucion 2.0 del runtime (RUN/OUT/STOP).
 *
 * Es el equivalente BLE de `MicroPythonSession.runProgram` (serial): recibe el
 * codigo + modo (mpy/eda6) + perfil (WEMOS/ESP32), lo envia en chunks base64,
 * y transmite la salida (OUT/ERR) a la consola en tiempo real, con Stop.
 *
 * Encapsulado: depende solo de un "transporte" con la interfaz
 *   { isConnected(), onData(cb), sendChunked(text), onStateChange?(cb) }
 * (implementada por BluetoothTransport). Testeable con un transporte mock.
 */

import {
  RUN,
  RUN_MODES,
  RUN_PROFILES,
  MAX_PROGRAM_LENGTH,
  RUN_SOURCE_CHUNK,
  buildRunBegin,
  buildRunChunk,
  chunkProgram,
  parseRunFrame,
} from "./bleProtocol.js";

const READY_TIMEOUT_MS = 6000;
const CHUNK_DELAY_MS = 12;
const STOP_POLL_MS = 150;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BleRunSession {
  /** @param {{ isConnected:Function, onData:Function, sendChunked:Function, onStateChange?:Function }} transport */
  constructor(transport) {
    this._tr = transport;
    this._running = false;
    this._stopSent = false;
  }

  isConnected() {
    try {
      return !!this._tr && this._tr.isConnected();
    } catch {
      return false;
    }
  }

  isRunning() {
    return this._running;
  }

  /**
   * Ejecuta el codigo del alumno por BLE y transmite la salida.
   * Resuelve cuando el runtime informa RUN:DONE (fin normal o detenido).
   * @param {string} code
   * @param {{mode?:string, profile?:string, onOut?:Function, onErr?:Function,
   *          onStarted?:Function, shouldStop?:Function}} [opts]
   */
  async runProgram(code, opts = {}) {
    if (!this.isConnected()) throw new Error("BLE_NOT_CONNECTED");
    if (this._running) throw new Error("BLE_RUN_BUSY");

    const mode = opts.mode === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
    const profile = opts.profile === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
    const onOut = opts.onOut ?? (() => {});
    const onErr = opts.onErr ?? (() => {});
    const onStarted = opts.onStarted;
    const shouldStop = opts.shouldStop ?? (() => false);

    const source = String(code ?? "");
    const byteLen = new TextEncoder().encode(source).length;
    if (byteLen > MAX_PROGRAM_LENGTH) {
      const e = new Error("BLE_PROGRAM_TOO_LONG");
      throw e;
    }

    this._running = true;
    this._stopSent = false;

    let ready = false;
    let started = false;
    let resolveReady;
    let resolveDone;
    let readyTimer = null;
    const readyPromise = new Promise((res) => {
      resolveReady = res;
      readyTimer = setTimeout(() => res(false), READY_TIMEOUT_MS);
    });
    const donePromise = new Promise((res) => (resolveDone = res));

    const onFrame = (raw) => {
      const frame = parseRunFrame(raw);
      switch (frame.type) {
        case "ready":
          ready = true;
          if (readyTimer) clearTimeout(readyTimer);
          resolveReady(true);
          break;
        case "started":
          started = true;
          if (onStarted) {
            try {
              onStarted();
            } catch {
              /* ignore */
            }
          }
          break;
        case "out":
          onOut(frame.text ?? "");
          break;
        case "err":
          onErr(frame.text ?? "");
          break;
        case "error":
          onErr("[BLE RUN] " + (frame.code ?? "ERROR"));
          break;
        case "done":
          resolveDone("done");
          break;
        default:
          /* frames no relacionados con RUN (p. ej. PONG) se ignoran */
          break;
      }
    };

    const offData = this._tr.onData(onFrame);
    let offState = null;
    if (typeof this._tr.onStateChange === "function") {
      offState = this._tr.onStateChange((state) => {
        if (state === "disconnected" || state === "idle") {
          resolveDone("disconnected");
        }
      });
    }

    // Poller de Stop: envia STOP una vez si el usuario pidio detener.
    let stopPoller = null;
    const startStopPoller = () => {
      stopPoller = setInterval(() => {
        if (!this._running) return;
        if (!this._stopSent && shouldStop()) {
          this.stop().catch(() => {});
        }
      }, STOP_POLL_MS);
    };

    try {
      await this._tr.sendChunked(buildRunBegin(mode, profile));
      // Esperar READY (el runtime confirma que reseteo el buffer).
      const okReady = await readyPromise;
      if (!okReady || !ready) throw new Error("BLE_RUN_NO_READY");

      startStopPoller();

      const chunks = chunkProgram(source, RUN_SOURCE_CHUNK);
      for (const b64 of chunks) {
        if (shouldStop()) break;
        await this._tr.sendChunked(buildRunChunk(b64));
        if (CHUNK_DELAY_MS > 0) await sleep(CHUNK_DELAY_MS);
      }
      await this._tr.sendChunked(RUN.END);

      const outcome = await donePromise;
      if (outcome === "disconnected" && !started) {
        throw new Error("BLE_RUN_DISCONNECTED");
      }
    } finally {
      if (readyTimer) clearTimeout(readyTimer);
      if (stopPoller) clearInterval(stopPoller);
      if (offData) offData();
      if (offState) offState();
      this._running = false;
    }
  }

  /** Envia STOP al runtime para abortar el programa del alumno. */
  async stop() {
    if (!this.isConnected()) return;
    this._stopSent = true;
    try {
      await this._tr.sendChunked(RUN.STOP);
    } catch {
      /* ignore */
    }
  }
}
