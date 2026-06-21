import { createPyodideHwModule } from "./hardwareBridge.js";
import { formatPythonError } from "./i18n.js";
import { createCanvasModule, setCanvasHooks, resetCanvas } from "./pybot_canvas.js";

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

/**
 * @param {string} userCode
 * @param {{ onOut?: (s:string)=>void, onErr?: (s:string)=>void, pythonOnly?: boolean }} hooks
 */
export async function runPythonAsync(userCode, hooks = {}) {
  const out = hooks.onOut ?? (() => {});
  const err = hooks.onErr ?? (() => {});
  const pythonOnly = Boolean(hooks.pythonOnly);

  if (typeof globalThis.loadPyodide !== "function") {
    const msg = "El entorno de Python no está disponible. Recargá la página.";
    err(`${msg}\n`);
    throw new Error(msg);
  }

  globalThis.__PYBOT_STOP__ = false;

  const pyodide = await globalThis.loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  });

  // Pyodide "batched" puede entregar líneas sin salto final.
  // Para que print() se vea como en terminal clásica, reinsertamos \n si falta.
  pyodide.setStdout({
    batched: (s) => {
      const text = String(s);
      out(text.endsWith("\n") ? text : `${text}\n`);
    },
  });
  pyodide.setStderr({
    batched: (s) => {
      const text = String(s);
      err(text.endsWith("\n") ? text : `${text}\n`);
    },
  });

  const onInput = hooks.onInput;
  globalThis.__pybot_request_input__ = (promptText) => {
    if (onInput) return onInput(promptText);
    return Promise.resolve(globalThis.prompt?.(promptText) ?? "");
  };

  pyodide.registerJsModule(
    "pybot_hw",
    pythonOnly ? createPythonOnlyHwModule() : createPyodideHwModule(),
  );

  if (hooks.onCanvas) setCanvasHooks(hooks.onCanvas);
  resetCanvas();
  pyodide.registerJsModule("pybot_gfx", createCanvasModule());

  const userMigrated = normalizeUserCode(userCode);
  const full = `${PYTHON_PRELUDE}\n\n${userMigrated}\n`;
  try {
    await pyodide.runPythonAsync(full);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg.includes("detenido") || msg.includes("Programa detenido")) {
      out("\n[Detenido]\n");
    } else {
      err(`${formatPythonError(msg)}\n`);
    }
    throw e;
  }
}

export function signalStop() {
  globalThis.__PYBOT_STOP__ = true;
}
