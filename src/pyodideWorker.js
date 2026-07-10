/**
 * Web Worker dedicado a correr Pyodide (Python en el navegador).
 *
 * Por qué existe este archivo: antes Python corría en el hilo principal.
 * Un programa como `while True: print(a)` (sin ningún wait/sleep adentro)
 * nunca le devuelve el control al navegador, así que la pestaña entera se
 * congelaba (no solo "la ejecución"). Al mover Pyodide a este Worker, el
 * hilo principal (la UI) queda siempre libre, sin importar lo que haga el
 * código del alumno. El botón Stop ahora funciona SIEMPRE: en vez de pedirle
 * "por favor" a Python que se frene (cooperativo, poco confiable en un
 * bucle sin pausas), el hilo principal simplemente termina este Worker
 * (`worker.terminate()`), lo que corta la ejecución al instante sin
 * depender de que el código del alumno colabore.
 *
 * Este Worker no tiene acceso directo al DOM, al puerto serie (Web Serial)
 * ni al canvas visible. Esas operaciones (motor/servo/pines, dibujar en
 * pantalla, pedir un input) se piden por mensajes (RPC) al hilo principal,
 * que es quien de verdad las ejecuta y devuelve el resultado.
 */

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";
const PYODIDE_MODULE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs";

// Cargamos Pyodide con import() dinámico en tiempo de ejecución (no estático).
// Con el import estático, el build de producción de Vite reescribía el módulo
// del CDN a una variable que quedaba sin definir dentro del Worker
// ("pyodide_mjs is not defined"). El /* @vite-ignore */ hace que Vite deje el
// import tal cual para que el Worker lo baje del CDN al arrancar.
let loadPyodideFnPromise = null;
function getLoadPyodide() {
  if (!loadPyodideFnPromise) {
    loadPyodideFnPromise = import(/* @vite-ignore */ PYODIDE_MODULE_URL).then(
      (mod) => mod.loadPyodide,
    );
  }
  return loadPyodideFnPromise;
}

/**
 * API async nativa para Pyodide (compatible universal, sin run_sync/JSPI).
 * El código estilo escritorio se transforma automáticamente antes de ejecutar.
 */
const PYTHON_PRELUDE = `
import asyncio
import js
import pybot_hw

def _stopped():
    try:
        return bool(js.__PYBOT_STOP__)
    except Exception:
        return False

async def _amotor(pin, speed=0):
    if _stopped():
        raise RuntimeError("detenido")
    await pybot_hw.motor(int(pin), int(speed))

async def _aservo(pin, angle, angle_end=None, speed=5):
    p = int(pin)
    if angle_end is not None:
        ae = int(angle_end)
        a = int(angle)
        spd = max(1, min(10, int(speed)))
        step = 1 if ae > a else -1
        delay = 0.05 / (spd / 5)
        x = a
        while True:
            if _stopped():
                raise RuntimeError("detenido")
            await pybot_hw.servo_write(p, x)
            await asyncio.sleep(delay)
            if x == ae:
                break
            x += step
    else:
        await pybot_hw.servo_write(p, int(angle))

async def _await_hw(seconds):
    await pybot_hw.wait(float(seconds))

async def _apin(mode, pin_id, value=None):
    m = str(mode).lower().strip()
    if m == "in":
        return await pybot_hw.pin_read(pin_id)
    if m == "out":
        if value is None:
            value = 0
        await pybot_hw.pin_write(pin_id, value)
        return None
    if m == "pwm":
        if value is None:
            value = 0
        await pybot_hw.pin_write(pin_id, int(value))
        return None
    raise ValueError("pin_mode")

async def motor(pin, speed=0):
    return await _amotor(pin, speed)

async def servo(pin, angle, angle_end=None, speed=5):
    return await _aservo(pin, angle, angle_end, speed)

async def wait(seconds):
    return await _await_hw(seconds)

async def pin(*args):
    # Compatibilidad:
    # - pin("in", 7)
    # - pin("out", 2, 1)
    # - pin(7) / pin("A0")            -> lectura
    # - pin(2, 1)                     -> escritura digital
    if len(args) == 0:
        raise ValueError("pin_args")

    if isinstance(args[0], str) and args[0].lower().strip() in ("in", "out", "pwm"):
        mode = args[0]
        if len(args) < 2:
            raise ValueError("pin_args")
        pin_id = args[1]
        value = args[2] if len(args) >= 3 else None
        return await _apin(mode, pin_id, value)

    # pin(pin_id, "in"/"out", [value]) estilo alternativo escritorio
    if len(args) >= 2 and isinstance(args[1], str) and args[1].lower().strip() in ("in", "out", "pwm"):
        pin_id = args[0]
        mode = args[1]
        value = args[2] if len(args) >= 3 else None
        return await _apin(mode, pin_id, value)

    pin_id = args[0]
    if len(args) == 1:
        return await _apin("in", pin_id, None)
    if len(args) == 2:
        return await _apin("out", pin_id, args[1])

    raise ValueError("pin_args")

async def input(prompt=""):
    result = await js.__pybot_request_input__(str(prompt))
    return str(result) if result is not None else ""

async def sleep(seconds):
    return await _await_hw(seconds)

import time
def _safe_sleep(secs):
    raise RuntimeError("time_sleep_blocked")
time.sleep = _safe_sleep

import pybot_gfx as _gfx

async def screen(w=400, h=300):
    await _gfx.screen(int(w), int(h))

async def fill(color="black"):
    await _gfx.fill(str(color))

async def draw_rect(x, y, w, h, color="white"):
    await _gfx.draw_rect(int(x), int(y), int(w), int(h), str(color))

async def draw_circle(x, y, radius, color="white"):
    await _gfx.draw_circle(int(x), int(y), int(radius), str(color))

async def draw_line(x1, y1, x2, y2, color="white", width=2):
    await _gfx.draw_line(int(x1), int(y1), int(x2), int(y2), str(color), int(width))

async def draw_text(x, y, msg, color="white", size=18):
    await _gfx.draw_text(int(x), int(y), str(msg), str(color), int(size))

async def flip():
    await _gfx.flip()

async def clear():
    await _gfx.clear()

async def key_pressed(name):
    return bool(await _gfx.key_pressed(str(name)))

# Aliases español (backward compat)
pantalla = screen
fondo = fill
dibujar_rect = draw_rect
dibujar_circulo = draw_circle
dibujar_linea = draw_line
texto = draw_text
actualizar = flip
limpiar = clear
tecla = key_pressed
`;

function isInsideStringOrComment(src, pos) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < pos; i++) {
    const ch = src[i];
    if (ch === "\\" && (inSingle || inDouble)) { i++; continue; }
    if (ch === "#" && !inSingle && !inDouble) return true;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

// Funciones async del runtime (deben llamarse con await en Pyodide).
const HARDWARE_NAMES = [
  "pin", "motor", "servo", "wait", "input", "sleep",
  "screen", "fill", "draw_rect", "draw_circle",
  "draw_line", "draw_text", "flip", "clear", "key_pressed",
  "pantalla", "fondo", "dibujar_rect", "dibujar_circulo",
  "dibujar_linea", "texto", "actualizar", "limpiar", "tecla",
];

function addAwaitForHardwareCalls(line, extraNames = []) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return line;
  if (/^\s*(def|async\s+def)\s+/.test(line)) return line;
  if (/^\s*from\s+/.test(line) || /^\s*import\s+/.test(line)) return line;
  if (/^\s*await\b/.test(line)) return line;

  let out = line;
  const names = extraNames.length ? [...HARDWARE_NAMES, ...extraNames] : HARDWARE_NAMES;

  for (const n of names) {
    const re = new RegExp(`(?<!await\\s)(?<!\\.)\\b${n}\\s*\\(`, "g");
    const hits = [];
    let m;
    while ((m = re.exec(out)) !== null) {
      if (!isInsideStringOrComment(out, m.index)) {
        hits.push({ index: m.index, len: m[0].length });
      }
    }
    for (let k = hits.length - 1; k >= 0; k--) {
      const { index: nameStart, len: matchLen } = hits[k];
      const parenPos = nameStart + matchLen - 1;
      let depth = 1;
      let j = parenPos + 1;
      let inStr = null;
      while (j < out.length && depth > 0) {
        const ch = out[j];
        if (inStr) {
          if (ch === "\\") { j += 2; continue; }
          if (ch === inStr) inStr = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; j++; continue; }
        if (ch === "#") break;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        j++;
      }
      if (depth !== 0) continue;
      const fullCall = out.slice(nameStart, j);
      out = out.slice(0, nameStart) + `(await ${fullCall})` + out.slice(j);
    }
  }

  return out;
}

/**
 * Acepta código estilo escritorio y async viejo, y lo lleva al formato Pyodide.
 */
function safeLineReplace(line, pattern, replacement) {
  return line.replace(pattern, (match, ...rest) => {
    const offset = rest[rest.length - 2];
    if (isInsideStringOrComment(line, offset)) return match;
    return typeof replacement === "function" ? replacement(match) : replacement;
  });
}

/**
 * Convierte a `async def` las funciones del usuario cuyo cuerpo usa hardware
 * (o llama a otra función async, en cascada), y devuelve esos nombres para que
 * sus llamadas se hagan con await. Esto permite escribir procedimientos/funciones
 * limpios en PyBlock/Python (def normal) y que igualmente corran en Pyodide,
 * donde la API de hardware es async.
 *
 * Es additivo: si no hay funciones con hardware adentro, devuelve el código tal
 * cual (el caso de `def main` lo sigue manejando normalizeUserCode aparte).
 */
function lineHasCall(line, name) {
  const re = new RegExp(`(?<!\\.)\\b${name}\\s*\\(`);
  const idx = line.search(re);
  return idx >= 0 && !isInsideStringOrComment(line, idx);
}

function asyncifyUserFunctions(code) {
  const lines = code.split("\n");
  const defRe = /^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(defRe);
    if (!m) continue;
    const indent = m[1].length;
    let bodyEnd = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      const ind = lines[j].length - lines[j].trimStart().length;
      if (ind <= indent) {
        bodyEnd = j;
        break;
      }
    }
    defs.push({ i, indent, isAsync: !!m[2], name: m[3], bodyStart: i + 1, bodyEnd });
  }
  if (defs.length === 0) return { code, asyncNames: new Set() };

  const asyncNames = new Set();
  for (const d of defs) {
    if (d.isAsync) {
      asyncNames.add(d.name);
      continue;
    }
    for (let j = d.bodyStart; j < d.bodyEnd; j++) {
      if (HARDWARE_NAMES.some((n) => lineHasCall(lines[j], n))) {
        asyncNames.add(d.name);
        break;
      }
    }
  }
  // Cascada: una función que llama a otra async, también es async.
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of defs) {
      if (asyncNames.has(d.name)) continue;
      for (let j = d.bodyStart; j < d.bodyEnd; j++) {
        let hit = false;
        for (const an of asyncNames) {
          if (lineHasCall(lines[j], an)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          asyncNames.add(d.name);
          changed = true;
          break;
        }
      }
    }
  }

  for (const d of defs) {
    if (asyncNames.has(d.name) && !d.isAsync) {
      lines[d.i] = lines[d.i].replace(/^(\s*)def\s+/, "$1async def ");
    }
  }
  return { code: lines.join("\n"), asyncNames };
}

function normalizeUserCode(code) {
  let s = code;

  s = s
    .split("\n")
    .map((line) => {
      let l = safeLineReplace(
        line,
        /asyncio\.run\s*\(\s*main\s*\(\s*\)\s*\)/g,
        "await main()",
      );
      l = safeLineReplace(l, /\bmain\s*\(\s*\)\s*$/g, "await main()");
      return l;
    })
    .join("\n");

  const hasAsyncMain = /\basync\s+def\s+main\s*\(/.test(s);
  const hasSyncMain = /\bdef\s+main\s*\(/.test(s);

  if (hasSyncMain && !hasAsyncMain) {
    s = s.replace(/\bdef\s+main\s*\(/, "async def main(");
  }

  // Funciones/procedimientos del usuario con hardware adentro -> async.
  let extraAwaitNames = [];
  try {
    const result = asyncifyUserFunctions(s);
    s = result.code;
    extraAwaitNames = [...result.asyncNames].filter((n) => n !== "main");
  } catch {
    extraAwaitNames = [];
  }

  s = s
    .split("\n")
    .map((line) => addAwaitForHardwareCalls(line, extraAwaitNames))
    .join("\n");

  s = s.replace(/\bawait\s+await\s+/g, "await ");
  return s;
}

// ---- RPC hacia el hilo principal (hardware real, canvas, input) ----
let _callSeq = 0;
const _pending = new Map();

function rpcCall(type, payload) {
  return new Promise((resolve, reject) => {
    const callId = ++_callSeq;
    _pending.set(callId, { resolve, reject });
    postMessage({ type, callId, ...payload });
  });
}

function resolvePending(callId, value) {
  const p = _pending.get(callId);
  if (!p) return;
  _pending.delete(callId);
  p.resolve(value);
}

function rejectPending(callId, message) {
  const p = _pending.get(callId);
  if (!p) return;
  _pending.delete(callId);
  p.reject(new Error(message || "error"));
}

function requestInput(promptText) {
  return rpcCall("input_request", { prompt: promptText });
}

function createPythonOnlyHwModule() {
  return {
    motor: async () => null,
    servo_write: async () => null,
    wait: async (seconds) =>
      new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(seconds) * 1000))),
    pin_read: async () => 0,
    pin_write: async () => null,
  };
}

function createRealHwModule() {
  return {
    motor: (pin, speed) => rpcCall("hw_call", { name: "motor", args: [pin, speed] }),
    servo_write: (pin, angle) => rpcCall("hw_call", { name: "servo_write", args: [pin, angle] }),
    wait: (seconds) => rpcCall("hw_call", { name: "wait", args: [seconds] }),
    pin_read: (pinId) => rpcCall("hw_call", { name: "pin_read", args: [pinId] }),
    pin_write: (pinId, value) => rpcCall("hw_call", { name: "pin_write", args: [pinId, value] }),
  };
}

const GFX_NAMES = [
  "screen", "fill", "draw_rect", "draw_circle", "draw_line",
  "draw_text", "flip", "clear", "key_pressed", "width", "height",
];

function createGfxModule() {
  const api = {};
  for (const name of GFX_NAMES) {
    api[name] = (...args) => rpcCall("canvas_call", { name, args });
  }
  return api;
}

let pyodidePromise = null;

function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = getLoadPyodide()
      .then((loadPyodide) => loadPyodide({ indexURL: PYODIDE_INDEX_URL }))
      .catch((e) => {
        pyodidePromise = null;
        throw e;
      });
  }
  return pyodidePromise;
}

// Agrupado de salida por tiempo (estilo Trinket). Un programa como
// `while True: print(a)` genera muchísima salida por segundo. En vez de
// mandar cada línea al toque (lo que saturaba la interfaz), acumulamos en un
// buffer y lo enviamos como mucho cada FLUSH_MS. Así la salida "fluye" en vivo
// y suave, sin cuelgues, sin tope, y sin mensajes raros. Como el chequeo usa
// Date.now() (sincrónico), funciona incluso dentro de un bucle que no cede el
// control. Detener sigue cortando al instante (el hilo principal mata el Worker).
const FLUSH_MS = 50;
// Solo tiene sentido mandar lo último que entra en pantalla; recortamos la cola
// para no crecer sin límite si el bucle imprime a velocidad bestial.
const MAX_TAIL = 16384;

async function runOne(runId, code, pythonOnly) {
  // Sin bandera compartida real: la parada de verdad la hace el hilo
  // principal terminando este Worker. Esto queda en False siempre; se
  // conserva _stopped() en el prelude solo por compatibilidad interna.
  self.__PYBOT_STOP__ = false;
  self.__pybot_request_input__ = (promptText) => requestInput(promptText);

  let pyodide;
  try {
    pyodide = await getPyodide();
  } catch (e) {
    postMessage({ type: "error", runId, message: e?.message ?? String(e) });
    return;
  }

  let outBuf = "";
  let errBuf = "";
  let lastFlush = 0;
  const flushOutput = (force) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS) return;
    lastFlush = now;
    if (outBuf) {
      postMessage({ type: "stdout", text: outBuf });
      outBuf = "";
    }
    if (errBuf) {
      postMessage({ type: "stderr", text: errBuf });
      errBuf = "";
    }
  };

  pyodide.setStdout({
    batched: (s) => {
      const text = String(s);
      outBuf += text.endsWith("\n") ? text : `${text}\n`;
      if (outBuf.length > MAX_TAIL) outBuf = outBuf.slice(-MAX_TAIL);
      flushOutput(false);
    },
  });
  pyodide.setStderr({
    batched: (s) => {
      const text = String(s);
      errBuf += text.endsWith("\n") ? text : `${text}\n`;
      if (errBuf.length > MAX_TAIL) errBuf = errBuf.slice(-MAX_TAIL);
      flushOutput(false);
    },
  });

  pyodide.registerJsModule("pybot_hw", pythonOnly ? createPythonOnlyHwModule() : createRealHwModule());
  pyodide.registerJsModule("pybot_gfx", createGfxModule());

  const userMigrated = normalizeUserCode(code);
  const full = `${PYTHON_PRELUDE}\n\n${userMigrated}\n`;

  try {
    await pyodide.runPythonAsync(full);
    flushOutput(true);
    postMessage({ type: "done", runId });
  } catch (e) {
    flushOutput(true);
    postMessage({ type: "error", runId, message: e?.message ?? String(e) });
  }
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "run":
      runOne(msg.runId, msg.code, Boolean(msg.pythonOnly));
      break;
    case "hw_result":
    case "canvas_result":
      resolvePending(msg.callId, msg.result);
      break;
    case "input_result":
      resolvePending(msg.callId, msg.value);
      break;
    case "hw_error":
    case "canvas_error":
      rejectPending(msg.callId, msg.message);
      break;
    default:
      break;
  }
};
