import { createPyodideHwModule } from "./hardwareBridge.js";

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
        # Compat escritorio: pin("out", pin) sin valor -> LOW por defecto
        if value is None:
            value = 0
        await pybot_hw.pin_write(pin_id, value)
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

    if isinstance(args[0], str) and args[0].lower().strip() in ("in", "out"):
        mode = args[0]
        if len(args) < 2:
            raise ValueError("pin_args")
        pin_id = args[1]
        value = args[2] if len(args) >= 3 else None
        return await _apin(mode, pin_id, value)

    # pin(pin_id, "in"/"out", [value]) estilo alternativo escritorio
    if len(args) >= 2 and isinstance(args[1], str) and args[1].lower().strip() in ("in", "out"):
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
`;

function addAwaitForHardwareCalls(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return line;
  if (/^\s*(def|async\s+def)\s+/.test(line)) return line;
  if (/^\s*from\s+/.test(line) || /^\s*import\s+/.test(line)) return line;
  if (/^\s*await\b/.test(line)) return line;

  let out = line;
  const names = ["pin", "motor", "servo", "wait"];
  for (const n of names) {
    const re = new RegExp(`(?<!await\\s)\\b${n}\\s*\\(`, "g");
    out = out.replace(re, `await ${n}(`);
  }
  return out;
}

/**
 * Acepta código estilo escritorio y async viejo, y lo lleva al formato Pyodide.
 */
function normalizeUserCode(code) {
  let s = code;
  // Entradas comunes de versiones anteriores
  s = s.replace(/asyncio\.run\s*\(\s*main\s*\(\s*\)\s*\)/g, "await main()");
  s = s.replace(/\bmain\s*\(\s*\)\s*$/gm, "await main()");

  const hasAsyncMain = /\basync\s+def\s+main\s*\(/.test(s);
  const hasSyncMain = /\bdef\s+main\s*\(/.test(s);

  if (hasSyncMain && !hasAsyncMain) {
    s = s.replace(/\bdef\s+main\s*\(/, "async def main(");
  }

  s = s
    .split("\n")
    .map((line) => addAwaitForHardwareCalls(line))
    .join("\n");

  // Evitar dobles await por reemplazos anteriores
  s = s.replace(/\bawait\s+await\s+/g, "await ");
  return s;
}

/**
 * @param {string} userCode
 * @param {{ onOut?: (s:string)=>void, onErr?: (s:string)=>void }} hooks
 */
export async function runPythonAsync(userCode, hooks = {}) {
  const out = hooks.onOut ?? (() => {});
  const err = hooks.onErr ?? (() => {});

  if (typeof globalThis.loadPyodide !== "function") {
    throw new Error(
      "Pyodide no está cargado. Recargá la página (script pyodide en index.html).",
    );
  }

  globalThis.__PYBOT_STOP__ = false;

  const pyodide = await globalThis.loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  });

  pyodide.setStdout({ batched: (s) => out(String(s)) });
  pyodide.setStderr({ batched: (s) => err(String(s)) });

  pyodide.registerJsModule("pybot_hw", createPyodideHwModule());

  const userMigrated = normalizeUserCode(userCode);
  const full = `${PYTHON_PRELUDE}\n\n${userMigrated}\n`;
  try {
    await pyodide.runPythonAsync(full);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg.includes("detenido") || msg.includes("Programa detenido")) {
      out("\n[Detenido]\n");
    } else {
      err(msg + "\n");
    }
    throw e;
  }
}

export function signalStop() {
  globalThis.__PYBOT_STOP__ = true;
}
