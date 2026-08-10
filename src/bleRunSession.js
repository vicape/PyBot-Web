/**
 * BleRunSession: ejecuta el programa del alumno EN una ESP32 conectada por BLE,
 * hablando el protocolo de ejecucion del runtime (RUN/OUT/STOP), protocolo 3.0.
 *
 * Es el equivalente BLE de `MicroPythonSession.runProgram` (serial): recibe el
 * codigo + modo (mpy/eda6) + perfil (WEMOS/ESP32), lo envia en chunks base64,
 * y transmite la salida (OUT/ERR) a la consola en tiempo real, con Stop.
 *
 * STOP confiable (protocolo 3.0):
 *   - `stop()` envia STOP (cooperativo). Si el programa no confirma (RUN:STOPPED
 *     o RUN:DONE) dentro de STOP_ESCALATE_MS, escala a STOP:FORCE, que provoca un
 *     reinicio con safe boot en la placa (recuperacion real de bucles que no ceden).
 *   - TODOS los estados terminales (RUN:DONE, RUN:STOPPED, RUN:ERROR, desconexion)
 *     resuelven la promesa; no quedan listeners/timers huerfanos (limpieza en finally).
 *   - NO hay timeout para la duracion legitima del programa del alumno; si hay
 *     timeouts para el handshake (READY) y para el ACK de STOP (escalado).
 *
 * Encapsulado: depende solo de un "transporte" con la interfaz
 *   { isConnected(), onData(cb), sendChunked(text), onStateChange?(cb) }
 * (implementada por BluetoothTransport). Testeable con un transporte mock.
 */

import {
  RUN,
  RUN_MODES,
  RUN_PROFILES,
  MAX_RUN_PROGRAM_SIZE,
  RUN_SOURCE_CHUNK,
  buildRunBegin,
  buildRunChunk,
  chunkProgram,
  parseRunFrame,
} from "./bleProtocol.js";

const READY_TIMEOUT_MS = 6000;
const CHUNK_DELAY_MS = 12;
const STOP_POLL_MS = 150;
// Si tras pedir STOP no llega confirmacion, escalar a STOP:FORCE (reset + safe boot).
const STOP_ESCALATE_MS = 3500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BleRunSession {
  /** @param {{ isConnected:Function, onData:Function, sendChunked:Function, onStateChange?:Function }} transport */
  constructor(transport) {
    this._tr = transport;
    this._running = false;
    this._stopSent = false;
    this._forceSent = false;
    this._stopRequested = false;
    this._escalateTimer = null;
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
   * Resuelve con { outcome } cuando el runtime informa un estado terminal
   * (done | stopped | error). Rechaza con BLE_RUN_DISCONNECTED si se pierde la
   * conexion antes de empezar, o BLE_* ante errores de handshake/tamano/conexion.
   * @param {string} code
   * @param {{mode?:string, profile?:string, onOut?:Function, onErr?:Function,
   *          onStarted?:Function, onStopped?:Function, shouldStop?:Function}} [opts]
   * @returns {Promise<{ outcome: "done"|"stopped"|"error"|"disconnected" }>}
   */
  async runProgram(code, opts = {}) {
    if (!this.isConnected()) throw new Error("BLE_NOT_CONNECTED");
    if (this._running) throw new Error("BLE_RUN_BUSY");

    const mode = opts.mode === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
    const profile = opts.profile === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
    const onOut = opts.onOut ?? (() => {});
    const onErr = opts.onErr ?? (() => {});
    const onStarted = opts.onStarted;
    const onStopped = opts.onStopped;
    const shouldStop = opts.shouldStop ?? (() => false);

    const source = String(code ?? "");
    const byteLen = new TextEncoder().encode(source).length;
    if (byteLen > MAX_RUN_PROGRAM_SIZE) {
      throw new Error("BLE_PROGRAM_TOO_LONG");
    }

    this._running = true;
    this._stopSent = false;
    this._forceSent = false;
    this._stopRequested = false;

    let ready = false;
    let started = false;
    let settledOutcome = null;
    let resolveReady;
    let resolveDone;
    let readyTimer = null;
    const readyPromise = new Promise((res) => {
      resolveReady = res;
      readyTimer = setTimeout(() => res(false), READY_TIMEOUT_MS);
    });
    const donePromise = new Promise((res) => (resolveDone = res));

    const settle = (outcome) => {
      if (settledOutcome != null) return;
      settledOutcome = outcome;
      resolveDone(outcome);
    };

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
          // RUN:ERROR:<code> es un estado TERMINAL (error de protocolo/arranque:
          // BUSY/TOO_LONG/NO_PROGRAM/BAD_ENCODING/BAD_FRAME). No esperamos RUN:DONE:
          // informamos y cerramos la sesion (settle -> limpieza en finally).
          onErr("[BLE RUN] " + (frame.code ?? "ERROR"));
          settle("error");
          break;
        case "stopped":
          if (onStopped) {
            try {
              onStopped();
            } catch {
              /* ignore */
            }
          }
          settle("stopped");
          break;
        case "done":
          settle(this._stopRequested ? "stopped" : "done");
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
          // Un STOP:FORCE reinicia la placa (se cae la conexion): eso ES un stop.
          settle(this._stopRequested ? "stopped" : "disconnected");
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
      return { outcome };
    } finally {
      if (readyTimer) clearTimeout(readyTimer);
      if (stopPoller) clearInterval(stopPoller);
      if (this._escalateTimer) {
        clearTimeout(this._escalateTimer);
        this._escalateTimer = null;
      }
      if (offData) offData();
      if (offState) offState();
      this._running = false;
    }
  }

  /**
   * Envia STOP al runtime para abortar el programa del alumno (STOP cooperativo).
   * Si no hay confirmacion dentro de STOP_ESCALATE_MS, escala a STOP:FORCE.
   * @param {{ force?: boolean }} [opts]
   */
  async stop(opts = {}) {
    if (!this.isConnected()) return;
    this._stopRequested = true;
    if (opts.force) {
      return this.forceStop();
    }
    if (this._stopSent) return;
    this._stopSent = true;
    try {
      await this._tr.sendChunked(RUN.STOP);
    } catch {
      /* ignore */
    }
    // Escalado: si el programa no cede (bucle sin puntos de espera), forzar.
    if (this._escalateTimer) clearTimeout(this._escalateTimer);
    this._escalateTimer = setTimeout(() => {
      if (this._running && !this._forceSent) {
        this.forceStop().catch(() => {});
      }
    }, STOP_ESCALATE_MS);
  }

  /** Fuerza la detencion: STOP:FORCE (reset + safe boot en la placa). */
  async forceStop() {
    if (!this.isConnected()) return;
    this._stopRequested = true;
    if (this._forceSent) return;
    this._forceSent = true;
    try {
      await this._tr.sendChunked(RUN.STOP_FORCE);
    } catch {
      /* ignore */
    }
  }
}
