import { createPyodideHwModule } from "./hardwareBridge.js";
import { formatPythonError } from "./i18n.js";

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

function addAwaitForHardwareCalls(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return line;
  if (/^\s*(def|async\s+def)\s+/.test(line)) return line;
  if (/^\s*from\s+/.test(line) || /^\s*import\s+/.test(line)) return line;
  if (/^\s*await\b/.test(line)) return line;

  let out = line;
  const names = ["pin", "motor", "servo", "wait", "input", "sleep"];

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

  s = s
    .split("\n")
    .map((line) => addAwaitForHardwareCalls(line))
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
