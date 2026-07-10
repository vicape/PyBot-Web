import { formatPythonError } from "./i18n.js";
import { hwMotor, hwServoWrite, hwWait, hwPinRead, hwPinWrite } from "./hardwareBridge.js";
import { createCanvasModule, setCanvasHooks, resetCanvas } from "./pybot_canvas.js";

/**
 * Puente entre la UI (hilo principal) y `pyodideWorker.js`, que es donde
 * realmente corre Python. Ver el comentario al tope de pyodideWorker.js
 * para el por qué: así la app nunca se congela y Stop siempre funciona,
 * incluso con un `while True` sin ningún wait/sleep adentro.
 */

let worker = null;
let runSeq = 0;
let currentRun = null; // { runId, hooks, resolve, reject, canvasApi, outBatcher, errBatcher }

function createOutputBatcher(flush) {
  let buffer = "";
  let scheduled = false;
  function run() {
    scheduled = false;
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    flush(text);
  }
  return {
    push(text) {
      buffer += text;
      // Defensa por si llega una ráfaga muy grande en un mismo frame:
      // nos quedamos con la cola (lo más nuevo) para no crecer sin límite.
      if (buffer.length > 65536) buffer = buffer.slice(-65536);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(run);
      }
    },
    flushNow() {
      if (scheduled) run();
    },
  };
}

function terminateWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
  }
  worker = null;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./pyodideWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => handleWorkerMessage(worker, ev.data);
  worker.onerror = (ev) => handleWorkerFatalError(ev);
  return worker;
}

async function dispatchHwCall(name, args) {
  switch (name) {
    case "motor":
      return hwMotor(args[0], args[1]);
    case "servo_write":
      return hwServoWrite(args[0], args[1]);
    case "wait":
      return hwWait(args[0]);
    case "pin_read":
      return hwPinRead(args[0]);
    case "pin_write":
      return hwPinWrite(args[0], args[1]);
    default:
      throw new Error(`hw_call desconocido: ${name}`);
  }
}

function finishRun(errorInfo) {
  if (!currentRun) return;
  const { resolve, reject, outBatcher, errBatcher } = currentRun;
  outBatcher.flushNow();
  errBatcher.flushNow();
  currentRun = null;
  if (errorInfo) reject(errorInfo);
  else resolve();
}

function handleWorkerMessage(w, msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "stdout":
      currentRun?.outBatcher.push(msg.text);
      break;
    case "stderr":
      currentRun?.errBatcher.push(msg.text);
      break;
    case "hw_call": {
      dispatchHwCall(msg.name, msg.args)
        .then((result) => w.postMessage({ type: "hw_result", callId: msg.callId, result: result ?? null }))
        .catch((e) => w.postMessage({ type: "hw_error", callId: msg.callId, message: e?.message ?? String(e) }));
      break;
    }
    case "canvas_call": {
      const api = currentRun?.canvasApi;
      if (!api || typeof api[msg.name] !== "function") {
        w.postMessage({ type: "canvas_error", callId: msg.callId, message: "canvas_not_ready" });
        break;
      }
      Promise.resolve()
        .then(() => api[msg.name](...msg.args))
        .then((result) => w.postMessage({ type: "canvas_result", callId: msg.callId, result: result ?? null }))
        .catch((e) => w.postMessage({ type: "canvas_error", callId: msg.callId, message: e?.message ?? String(e) }));
      break;
    }
    case "input_request": {
      const onInput = currentRun?.hooks.onInput;
      Promise.resolve(onInput ? onInput(msg.prompt) : globalThis.prompt?.(msg.prompt) ?? "")
        .then((value) => w.postMessage({ type: "input_result", callId: msg.callId, value: value == null ? "" : String(value) }))
        .catch(() => w.postMessage({ type: "input_result", callId: msg.callId, value: "" }));
      break;
    }
    case "done": {
      if (currentRun && currentRun.runId === msg.runId) finishRun(null);
      break;
    }
    case "error": {
      if (currentRun && currentRun.runId === msg.runId) {
        const msgText = msg.message ?? "Error";
        currentRun.hooks.onErr?.(`${formatPythonError(msgText)}\n`);
        finishRun(new Error(msgText));
      }
      break;
    }
    default:
      break;
  }
}

function handleWorkerFatalError(ev) {
  terminateWorker();
  if (currentRun) {
    const message = ev?.message || "El entorno de Python se interrumpió inesperadamente.";
    currentRun.hooks.onErr?.(`${message}\n`);
    finishRun(new Error(message));
  }
}

/**
 * @param {string} userCode
 * @param {{ onOut?: (s:string)=>void, onErr?: (s:string)=>void, pythonOnly?: boolean }} hooks
 */
export async function runPythonAsync(userCode, hooks = {}) {
  const pythonOnly = Boolean(hooks.pythonOnly);
  const w = ensureWorker();
  const runId = ++runSeq;

  if (hooks.onCanvas) setCanvasHooks(hooks.onCanvas);
  resetCanvas();
  const canvasApi = createCanvasModule();

  const outBatcher = createOutputBatcher((text) => hooks.onOut?.(text));
  const errBatcher = createOutputBatcher((text) => hooks.onErr?.(text));

  return new Promise((resolve, reject) => {
    currentRun = { runId, hooks, resolve, reject, canvasApi, outBatcher, errBatcher };
    try {
      w.postMessage({ type: "run", runId, code: userCode, pythonOnly });
    } catch (e) {
      currentRun = null;
      reject(e);
    }
  });
}

export function signalStop() {
  // Se mantiene por compatibilidad: lo usa el modo placa (ESP32), que no
  // pasa por este Worker sino por su propia sesión REPL.
  globalThis.__PYBOT_STOP__ = true;

  if (!currentRun) return; // nada corriendo en Pyodide: no tocamos el worker precargado

  currentRun.hooks.onOut?.("\n[Detenido]\n");
  const reject = currentRun.reject;
  currentRun = null;
  terminateWorker();
  reject(new Error("PYBOT_STOPPED"));
}
