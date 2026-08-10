/**
 * BleDeploySession: transferencia PERSISTENTE del programa del alumno a la ESP32
 * por BLE (protocolo DEPLOY 3.0) + control de la app persistente (APP:*).
 *
 * Deploy: DEPLOY:BEGIN:<mode>:<profile>:<size>:<hash> -> DEPLOY:READY ->
 *   (DEPLOY:CHUNK:<b64> -> DEPLOY:ACK:<n>)* -> DEPLOY:END ->
 *   DEPLOY:VERIFY:OK | DEPLOY:ERROR:<code>.
 *
 * El ACK es por BLOQUE (una linea DEPLOY:CHUNK, no por fragmento GATT de 20B):
 * da backpressure y deteccion de perdidas sin miles de round trips. El hash
 * SHA-256 (calculado en JS puro, identico a uhashlib en el firmware) garantiza
 * que lo guardado en flash sea EXACTAMENTE lo enviado (transferencia atomica).
 *
 * Todas las esperas tienen timeout (READY / ACK / VERIFY) EXCEPTO la duracion
 * legitima de un programa; la desconexion durante DEPLOY aborta y conserva la
 * app anterior intacta. Sin listeners/timers huerfanos (limpieza en finally).
 */

import {
  DEPLOY,
  APP,
  RUN,
  RUN_MODES,
  RUN_PROFILES,
  MAX_DEPLOY_PROGRAM_SIZE,
  buildDeployBegin,
  buildDeployChunk,
  chunkDeployProgram,
  parseDeployFrame,
  parseRunFrame,
  parseAppFrame,
  parseAppInfo,
  buildAppAutostart,
  sha256HexUtf8,
} from "./bleProtocol.js";

const READY_TIMEOUT_MS = 6000;
const ACK_TIMEOUT_MS = 6000;
const VERIFY_TIMEOUT_MS = 10000;
const APP_TIMEOUT_MS = 4000;
const STOP_ESCALATE_MS = 3500;
const STOP_POLL_MS = 150;

export class BleDeploySession {
  /** @param {{ isConnected:Function, onData:Function, sendChunked:Function, send?:Function, sendAndWait?:Function, onStateChange?:Function }} transport */
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
   * Transfiere y guarda el programa como app persistente (pybot_app.py) con
   * metadata. NO lo ejecuta (usar runSavedApp para eso).
   * @param {string} code
   * @param {{mode?:string, profile?:string, onProgress?:Function}} [opts]
   * @returns {Promise<{ ok:true, size:number, hash:string, mode:string, profile:string }>}
   */
  async deploy(code, opts = {}) {
    if (!this.isConnected()) throw new Error("BLE_NOT_CONNECTED");
    if (this._busy) throw new Error("BLE_DEPLOY_BUSY");

    const mode = opts.mode === RUN_MODES.EDA6 ? RUN_MODES.EDA6 : RUN_MODES.MPY;
    const profile = opts.profile === RUN_PROFILES.ESP32 ? RUN_PROFILES.ESP32 : RUN_PROFILES.WEMOS;
    const onProgress = opts.onProgress ?? (() => {});

    const source = String(code ?? "");
    const bytes = new TextEncoder().encode(source);
    if (bytes.length === 0) throw new Error("BLE_DEPLOY_EMPTY");
    if (bytes.length > MAX_DEPLOY_PROGRAM_SIZE) throw new Error("BLE_DEPLOY_TOO_LONG");
    const hash = sha256HexUtf8(source);

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
        p.reject(new Error("BLE_DEPLOY_DISCONNECTED"));
      }
    };

    const offData = this._tr.onData((raw) => {
      const f = parseDeployFrame(raw);
      if (f.type === "unknown") return; // ignora frames RUN/APP/PONG residuales
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
              reject(new Error("BLE_DEPLOY_TIMEOUT:" + label));
            }
          }, timeoutMs),
        };
        deliver();
      });

    try {
      await this._tr.sendChunked(buildDeployBegin(mode, profile, bytes.length, hash));
      const ready = await nextFrame(READY_TIMEOUT_MS, "ready");
      if (ready.type === "error") throw new Error("BLE_DEPLOY_ERROR:" + ready.code);
      if (ready.type !== "ready") throw new Error("BLE_DEPLOY_ERROR:UNEXPECTED");

      const chunks = chunkDeployProgram(source);
      onProgress({ phase: "begin", done: 0, total: chunks.length, pct: 0 });
      for (let i = 0; i < chunks.length; i++) {
        await this._tr.sendChunked(buildDeployChunk(chunks[i]));
        const ack = await nextFrame(ACK_TIMEOUT_MS, "ack");
        if (ack.type === "error") throw new Error("BLE_DEPLOY_ERROR:" + ack.code);
        if (ack.type !== "ack" || ack.index !== i) {
          throw new Error("BLE_DEPLOY_ERROR:BAD_ACK");
        }
        onProgress({
          phase: "chunk",
          done: i + 1,
          total: chunks.length,
          pct: Math.round(((i + 1) / chunks.length) * 100),
        });
      }

      await this._tr.sendChunked(DEPLOY.END);
      const verify = await nextFrame(VERIFY_TIMEOUT_MS, "verify");
      if (verify.type === "error") throw new Error("BLE_DEPLOY_ERROR:" + verify.code);
      if (verify.type !== "verify_ok") throw new Error("BLE_DEPLOY_ERROR:UNEXPECTED");

      onProgress({ phase: "done", done: chunks.length, total: chunks.length, pct: 100 });
      return { ok: true, size: bytes.length, hash, mode, profile };
    } catch (e) {
      // Best-effort: pedir al firmware que aborte y limpie el tmp (conserva la
      // app anterior). Si estamos desconectados, el firmware ya aborto solo.
      try {
        await this._tr.sendChunked(DEPLOY.ABORT);
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

// ===========================================================================
// Control de la app persistente (APP:*). Comandos cortos con respuesta unica.
// ===========================================================================

/**
 * Consulta el estado de la app persistente. @returns {Promise<object|null>}
 */
export async function appInfo(transport, timeoutMs = APP_TIMEOUT_MS) {
  if (!transport || !transport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const raw = await transport.sendAndWait(APP.INFO, timeoutMs);
  return parseAppInfo(raw);
}

async function _appCommand(transport, command, timeoutMs = APP_TIMEOUT_MS) {
  if (!transport || !transport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const raw = await transport.sendAndWait(command, timeoutMs);
  const f = parseAppFrame(raw);
  if (f.type === "error") throw new Error("BLE_APP_ERROR:" + f.code);
  return f;
}

/** Detiene la app persistente en ejecucion (cooperativo). */
export function appStop(transport) {
  return _appCommand(transport, APP.STOP);
}

/** Borra la app persistente y su metadata (NO el runtime/EDA6/pybot_mpy). */
export function appDelete(transport) {
  return _appCommand(transport, APP.DELETE);
}

/** Habilita/deshabilita el autostart de la app persistente. */
export function appAutostart(transport, on) {
  return _appCommand(transport, buildAppAutostart(on));
}

/**
 * Ejecuta la app persistente ya guardada (APP:START) y transmite su salida a la
 * consola en tiempo real, resolviendo cuando termina/​se detiene. STOP confiable
 * con escalado a STOP:FORCE (igual que BleRunSession).
 * @returns {Promise<{ outcome:"done"|"stopped"|"error"|"disconnected" }>}
 */
export async function runSavedApp(transport, opts = {}) {
  if (!transport || !transport.isConnected()) throw new Error("BLE_NOT_CONNECTED");
  const onOut = opts.onOut ?? (() => {});
  const onErr = opts.onErr ?? (() => {});
  const onStarted = opts.onStarted;
  const onStopped = opts.onStopped;
  const shouldStop = opts.shouldStop ?? (() => false);

  let started = false;
  let settled = null;
  let resolveDone;
  let stopSent = false;
  let forceSent = false;
  let stopRequested = false;
  let escalateTimer = null;
  const donePromise = new Promise((r) => (resolveDone = r));
  const settle = (o) => {
    if (settled == null) {
      settled = o;
      resolveDone(o);
    }
  };

  const onFrame = (raw) => {
    const app = parseAppFrame(raw);
    if (app.type === "error") {
      onErr("[APP] " + (app.code ?? "ERROR"));
      settle("error");
      return;
    }
    const f = parseRunFrame(raw);
    switch (f.type) {
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
        onOut(f.text ?? "");
        break;
      case "err":
        onErr(f.text ?? "");
        break;
      case "error":
        onErr("[BLE RUN] " + (f.code ?? "ERROR"));
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
        settle(stopRequested ? "stopped" : "done");
        break;
      default:
        break;
    }
  };

  const offData = transport.onData(onFrame);
  let offState = null;
  if (typeof transport.onStateChange === "function") {
    offState = transport.onStateChange((s) => {
      if (s === "disconnected" || s === "idle") {
        settle(stopRequested ? "stopped" : "disconnected");
      }
    });
  }

  const poller = setInterval(() => {
    if (settled != null) return;
    if (!stopSent && shouldStop()) {
      stopSent = true;
      stopRequested = true;
      transport.sendChunked(APP.STOP).catch(() => {});
      escalateTimer = setTimeout(() => {
        if (settled == null && !forceSent) {
          forceSent = true;
          transport.sendChunked(RUN.STOP_FORCE).catch(() => {});
        }
      }, STOP_ESCALATE_MS);
    }
  }, STOP_POLL_MS);

  try {
    await transport.sendChunked(APP.START);
    const outcome = await donePromise;
    return { outcome };
  } finally {
    clearInterval(poller);
    if (escalateTimer) clearTimeout(escalateTimer);
    if (offData) offData();
    if (offState) offState();
  }
}
