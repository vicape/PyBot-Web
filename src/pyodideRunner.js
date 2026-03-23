import { createPyodideHwModule } from "./hardwareBridge.js";

/**
 * Misma API que PyBot escritorio: pin(), motor(), servo(), wait() sin await.
 * Por dentro Pyodide habla con JS (async); pyodide.ffi.run_sync une ambos mundos.
 */
const PYTHON_PRELUDE = `
import asyncio
import js
import pybot_hw
from pyodide.ffi import run_sync

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
            raise ValueError("pin_args")
        await pybot_hw.pin_write(pin_id, value)
        return None
    raise ValueError("pin_mode")

def motor(pin, speed=0):
    return run_sync(_amotor(pin, speed))

def servo(pin, angle, angle_end=None, speed=5):
    return run_sync(_aservo(pin, angle, angle_end, speed))

def wait(seconds):
    return run_sync(_await_hw(seconds))

def pin(mode, pin_id, value=None):
    return run_sync(_apin(mode, pin_id, value))
`;

/**
 * Código viejo (async/await) → estilo escritorio para no romper pegados.
 */
function migrateLegacyAsyncCode(code) {
  let s = code;
  s = s.replace(/asyncio\.run\s*\(\s*main\s*\(\s*\)\s*\)/g, "main()");
  s = s.replace(/\bawait\s+main\s*\(\s*\)/g, "main()");
  s = s.replace(/\bawait\s+(pin|motor|wait|servo)\s*\(/g, "$1(");
  s = s.replace(/\basync\s+def\s+main\s*\(/g, "def main(");
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

  const userMigrated = migrateLegacyAsyncCode(userCode);
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
