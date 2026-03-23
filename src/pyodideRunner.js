import { createPyodideHwModule } from "./hardwareBridge.js";

const PYTHON_PRELUDE = `
import asyncio
import js
import pybot_hw

def _stopped():
    try:
        return bool(js.__PYBOT_STOP__)
    except Exception:
        return False

async def motor(pin, speed=0):
    if _stopped():
        raise RuntimeError("detenido")
    await pybot_hw.motor(int(pin), int(speed))

async def servo(pin, angle, angle_end=None, speed=5):
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

async def wait(seconds):
    await pybot_hw.wait(float(seconds))

async def pin(mode, pin_id, value=None):
    m = str(mode).lower().strip()
    if m == "in":
        return await pybot_hw.pin_read(pin_id)
    if m == "out":
        if value is None:
            raise ValueError("pin_args")
        await pybot_hw.pin_write(pin_id, value)
        return None
    raise ValueError("pin_mode")
`;

/**
 * Pyodide ejecuta el script dentro de un event loop ya activo;
 * asyncio.run() lanza "cannot be called from a running event loop".
 * Reemplazamos el patrón habitual por await a nivel superior.
 */
function patchAsyncioRunForPyodide(code) {
  let s = code;
  // asyncio.run(main()) → await main()
  s = s.replace(/asyncio\.run\s*\(\s*main\s*\(\s*\)\s*\)/g, "await main()");
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

  const userPatched = patchAsyncioRunForPyodide(userCode);
  const full = `${PYTHON_PRELUDE}\n\n${userPatched}\n`;
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
