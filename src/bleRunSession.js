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
 *   - El escalado a FORCE esta atado a una generacion de run (`_runGen`): si STOPPED
 *     llega mientras `await sendChunked(STOP)` aun no termino, NO debe armarse un
 *     timer huerfano que dispare FORCE en el *siguiente* Run (reset + disconnect).
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
/** Un reintento de RUN:BEGIN si el primero no obtiene READY (placa ocupada en cleanup). */
const READY_RETRY_MS = 250;
const CHUNK_DELAY_MS = 12;
const STOP_POLL_MS = 150;
// Si tras pedir STOP no llega confirmacion, escalar a STOP:FORCE (reset + safe boot).
export const STOP_ESCALATE_MS = 3500;

/** Callback opcional: (msg:string) => void — log visible de STOP:FORCE en la UI. */
let _forceLog = null;

/** Registra logger para mensajes "STOP:FORCE enviado (razón: …)". */
export function setBleForceStopLog(fn) {
  _forceLog = typeof fn === "function" ? fn : null;
}

function logForceSent(reason) {
  const msg = "STOP:FORCE enviado (razón: " + String(reason ?? "desconocida") + ")";
  try {
    _forceLog?.(msg);
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BleRunSession {
  /**
   * @param {{ isConnected:Function, onData:Function, sendChunked:Function, onStateChange?:Function }} transport
   * @param {{ onCoopStopped?: Function }} [opts]
   */
  constructor(transport, opts = {}) {
    this._tr = transport;
    this._onCoopStopped = typeof opts.onCoopStopped === "function" ? opts.onCoopStopped : null;
    this._running = false;
    this._stopSent = false;
    this._forceSent = false;
    this._stopRequested = false;
    this._escalateTimer = null;
    /** Generacion del run actual; el escalate de FORCE solo aplica a la misma. */
    this._runGen = 0;
    /**
     * Epoch del escalate: sube en cada settle/clear/nuevo run. El callback de
     * FORCE debe ver el mismo epoch con el que se armo (defensa extra a _runGen).
     */
    this._escalateEpoch = 0;
    /** True cuando el run actual ya tuvo desenlace terminal (no armar FORCE). */
    this._terminal = false;
    /** Generacion que ya confirmo RUN:STOPPED — NUNCA FORCE para esa gen. */
    this._stoppedGen = 0;
  }

  /** Generacion de run (para que el bridge aborte FORCE si ya arranco otro Run). */
  getRunGen() {
    return this._runGen;
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

  _clearEscalateTimer() {
    if (this._escalateTimer) {
      clearTimeout(this._escalateTimer);
      this._escalateTimer = null;
    }
    // Invalidar cualquier callback ya encolado (clearTimeout no cancela el que
    // esta ejecutandose; el epoch lo vuelve no-op).
    this._escalateEpoch += 1;
  }

  _armEscalateForce(genAtStop) {
    // Tras STOPPED de esta gen, o si el run ya termino: NUNCA armar FORCE.
    if (
      !this._running ||
      this._terminal ||
      this._runGen !== genAtStop ||
      this._stoppedGen === genAtStop
    ) {
      return;
    }
    this._clearEscalateTimer();
    const epoch = this._escalateEpoch;
    this._escalateTimer = setTimeout(() => {
      if (
        this._escalateEpoch !== epoch ||
        !this._running ||
        this._terminal ||
        this._forceSent ||
        this._runGen !== genAtStop ||
        this._stoppedGen === genAtStop
      ) {
        return;
      }
      this.forceStop("escalate-sin-STOPPED").catch(() => {});
    }, STOP_ESCALATE_MS);
  }

  /**
   * Tras un STOP cooperativo confirmado: invalida cualquier escalate FORCE
   * pendiente de este run (cinturón ante carreras con await sendChunked).
   */
  disarmForceEscalate() {
    this._clearEscalateTimer();
    if (!this._running) {
      this._terminal = true;
      this._stoppedGen = this._runGen;
    }
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

    // Cancelar cualquier escalate huerfano de un stop previo (best-effort / carrera).
    this._clearEscalateTimer();
    this._runGen += 1;
    const runGen = this._runGen;
    this._running = true;
    this._terminal = false;
    this._stopSent = false;
    this._forceSent = false;
    this._stopRequested = false;

    let ready = false;
    let started = false;
    let settledOutcome = null;
    let handshakeErr = null;
    let resolveReady;
    let resolveDone;
    let readyTimer = null;
    const armReadyTimer = () => {
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = setTimeout(() => resolveReady(false), READY_TIMEOUT_MS);
    };
    const readyPromise = new Promise((res) => {
      resolveReady = res;
      armReadyTimer();
    });
    const donePromise = new Promise((res) => (resolveDone = res));

    const settle = (outcome) => {
      if (settledOutcome != null) return;
      settledOutcome = outcome;
      this._terminal = true;
      // Cortar escalate en cuanto hay estado terminal (antes del finally), para
      // que un stop() aun en await sendChunked(STOP) no rearma FORCE.
      this._clearEscalateTimer();
      // Desbloquear el await de READY (p.ej. disconnect durante handshake).
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      resolveReady(false);
      resolveDone(outcome);
    };

    const failHandshake = (code) => {
      handshakeErr = code;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      resolveReady(false);
      settle("error");
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
          // BUSY/TOO_LONG/NO_PROGRAM/BAD_ENCODING/BAD_FRAME/LOAD:...). No esperamos
          // RUN:DONE: informamos y cerramos la sesion (settle -> limpieza en finally).
          // Si llega ANTES de READY (p.ej. lazy-import fallido), abortar el handshake
          // de inmediato en vez de esperar el timeout de READY.
          onErr("[BLE RUN] " + (frame.code ?? "ERROR"));
          if (!ready) {
            failHandshake("BLE_RUN_ERROR:" + (frame.code ?? "ERROR"));
          } else {
            settle("error");
          }
          break;
        case "stopped":
          // Marcar ANTES de settle: stop() puede rearmar escalate al salir del await.
          this._stoppedGen = runGen;
          if (onStopped) {
            try {
              onStopped();
            } catch {
              /* ignore */
            }
          }
          settle("stopped");
          try {
            this._onCoopStopped?.();
          } catch {
            /* ignore */
          }
          break;
        case "done":
          settle(this._stopRequested ? "stopped" : "done");
          break;
        default: {
          // Runtime 3.2.0 podia responder ERR,INTERNAL si el import en IRQ fallaba;
          // no es un frame RUN, pero tampoco hay que esperar 6s a READY.
          const rawText = String(raw ?? "").trim();
          if (!ready && /^ERR\b/i.test(rawText)) {
            onErr("[BLE RUN] " + rawText);
            failHandshake("BLE_RUN_INTERNAL");
          }
          break;
        }
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
      const beginFrame = buildRunBegin(mode, profile);
      await this._tr.sendChunked(beginFrame);
      let okReady = await readyPromise;
      // Reintento unico: tras Stop el manager puede tardar un tick en quedar idle
      // (cola RX en firmware 3.2.3). No confundir con runtime viejo.
      if (!okReady && !ready && !handshakeErr && settledOutcome == null && this.isConnected()) {
        await sleep(READY_RETRY_MS);
        if (settledOutcome == null && this.isConnected() && !ready) {
          const retryPromise = new Promise((res) => {
            resolveReady = res;
            armReadyTimer();
          });
          await this._tr.sendChunked(beginFrame);
          okReady = await retryPromise;
        }
      }
      if (handshakeErr || settledOutcome === "error") {
        // RUN:ERROR / ERR antes de READY: devolver outcome error (ya en onErr).
        if (handshakeErr && /BUSY/i.test(handshakeErr)) {
          throw new Error("BLE_RUN_ERROR:BUSY");
        }
        return { outcome: "error" };
      }
      // Desconexion durante el handshake: no confundir con runtime viejo (NO_READY).
      if (settledOutcome === "disconnected" || settledOutcome === "stopped") {
        if (settledOutcome === "disconnected" && !started) {
          throw new Error("BLE_RUN_DISCONNECTED");
        }
        return { outcome: settledOutcome };
      }
      // `ready` es la fuente de verdad (puede llegar justo tras el timeout).
      if (!ready) {
        if (!this.isConnected()) throw new Error("BLE_RUN_DISCONNECTED");
        throw new Error("BLE_RUN_NO_READY");
      }

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
      // Solo limpiar el timer si sigue perteneciendo a ESTE run (evita borrar el
      // escalate de un run posterior si hubiera solapamiento patologico).
      if (this._runGen === runGen) {
        this._clearEscalateTimer();
        this._running = false;
      }
      if (offData) offData();
      if (offState) offState();
    }
  }

  /**
   * Envia STOP al runtime para abortar el programa del alumno (STOP cooperativo).
   * Si no hay confirmacion dentro de STOP_ESCALATE_MS, escala a STOP:FORCE.
   * @param {{ force?: boolean, wait?: boolean }} [opts]
   *   `wait:true` espera a que el run deje de estar activo (STOPPED/FORCE/DONE).
   */
  async stop(opts = {}) {
    if (!this.isConnected()) return;
    this._stopRequested = true;
    if (opts.force) {
      await this.forceStop();
      if (opts.wait) await this._waitUntilIdle(STOP_ESCALATE_MS + 2500);
      return;
    }
    if (!this._stopSent) {
      this._stopSent = true;
      // Capturar generacion ANTES del await: si el run termina (STOPPED) mientras
      // enviamos STOP, no debemos armar escalate para un run futuro.
      const genAtStop = this._runGen;
      try {
        await this._tr.sendChunked(RUN.STOP);
      } catch {
        /* ignore */
      }
      // El programa ya confirmo (u otro settle) mientras enviabamos STOP.
      this._armEscalateForce(genAtStop);
    }
    if (opts.wait) {
      await this._waitUntilIdle(STOP_ESCALATE_MS + 2500);
      // Cinturón: tras wait, si ya no corre, NUNCA dejar escalate armado.
      if (!this._running) this.disarmForceEscalate();
    }
  }

  async _waitUntilIdle(timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this._running && Date.now() < deadline) {
      await sleep(50);
    }
  }

  /**
   * Fuerza la detencion: STOP:FORCE (reset + safe boot en la placa).
   * @param {string} [reason] motivo visible en consola si hay logger registrado
   */
  async forceStop(reason = "forceStop") {
    if (!this.isConnected()) return;
    // Nunca resetear la placa si el run ya termino (STOPPED/DONE) o no hay run:
    // un FORCE huerfano tumba GATT y rompe el siguiente Run.
    if (!this._running || this._terminal || this._stoppedGen === this._runGen) {
      return;
    }
    this._stopRequested = true;
    if (this._forceSent) return;
    this._forceSent = true;
    logForceSent(reason);
    try {
      await this._tr.sendChunked(RUN.STOP_FORCE);
    } catch {
      /* ignore */
    }
  }
}
