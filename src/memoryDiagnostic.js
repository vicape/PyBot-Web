/**
 * Diagnóstico de memoria para ESP32 (runtime BLE) por USB / raw REPL.
 *
 * Encapsulado y de SOLO lectura: no borra archivos ni reinicia la placa. Se
 * ejecuta sobre la sesión serial MicroPython ya conectada (mismo raw REPL que
 * usa installFile) para confirmar la hipótesis de que la placa se queda sin
 * memoria al preparar/compilar el núcleo BLE (pybot_ble.py / main.py) o al
 * activar BLE, y por eso deja de advertisar tras un reset.
 *
 * Este módulo es puro (sin dependencias del navegador/serial): expone el script
 * MicroPython y un parser testeable de su salida.
 */

/**
 * Script MicroPython corto y robusto que imprime líneas parseables:
 *   MEMFREE <bytes>
 *   MAINSIZE <bytes|NA>
 *   CORESIZE <bytes|NA>   (pybot_ble.py si existe; si no, main.py)
 *   COMPILE OK | MEMORYERROR | ERR <repr>
 *   BLE OK | MEMORYERROR | ERR <repr>
 *   DIAG_DONE
 *
 * Envuelto todo en try/except para que ningún paso deje la placa en un estado
 * raro (BLE se desactiva siempre que se haya activado).
 */
export const MEMORY_DIAGNOSTIC_SCRIPT = [
  "import gc",
  "gc.collect()",
  "print('MEMFREE', gc.mem_free())",
  "try:",
  "    import os",
  "    print('MAINSIZE', os.stat('main.py')[6])",
  "except Exception:",
  "    print('MAINSIZE', 'NA')",
  "try:",
  "    import os",
  "    print('CORESIZE', os.stat('pybot_ble.py')[6])",
  "    _core = 'pybot_ble.py'",
  "except Exception:",
  "    print('CORESIZE', 'NA')",
  "    _core = 'main.py'",
  "gc.collect()",
  "try:",
  "    _src = open(_core).read()",
  "    compile(_src, _core, 'exec')",
  "    print('COMPILE', 'OK')",
  "except MemoryError:",
  "    print('COMPILE', 'MEMORYERROR')",
  "except Exception as e:",
  "    print('COMPILE', 'ERR', repr(e))",
  "try:",
  "    _src = None",
  "except Exception:",
  "    pass",
  "gc.collect()",
  "_ble = None",
  "try:",
  "    import bluetooth",
  "    _ble = bluetooth.BLE()",
  "    _ble.active(True)",
  "    print('BLE', 'OK')",
  "except MemoryError:",
  "    print('BLE', 'MEMORYERROR')",
  "except Exception as e:",
  "    print('BLE', 'ERR', repr(e))",
  "finally:",
  "    try:",
  "        if _ble is not None:",
  "            _ble.active(False)",
  "    except Exception:",
  "        pass",
  "gc.collect()",
  "print('DIAG_DONE')",
].join("\n");

function parseIntOrNull(token) {
  const n = parseInt(token, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parsea la salida del diagnóstico y determina una conclusión.
 * Pure function (testeable con node:test).
 *
 * @param {string} text stdout del diagnóstico (líneas MEMFREE/MAINSIZE/COMPILE/BLE/DIAG_DONE)
 * @returns {{
 *   memFree: number|null,
 *   mainSize: number|null,
 *   coreSize: number|null,
 *   compile: 'OK'|'MEMORYERROR'|'ERR'|null,
 *   compileError: string|null,
 *   ble: 'OK'|'MEMORYERROR'|'ERR'|null,
 *   bleError: string|null,
 *   bleTested: boolean,
 *   done: boolean,
 *   conclusion: 'memory'|'ok'|'unknown'
 * }}
 */
export function parseMemoryDiagnostic(text) {
  const result = {
    memFree: null,
    mainSize: null,
    coreSize: null,
    compile: null,
    compileError: null,
    ble: null,
    bleError: null,
    bleTested: false,
    done: false,
    conclusion: "unknown",
  };

  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "DIAG_DONE") {
      result.done = true;
      continue;
    }
    const spaceIdx = line.indexOf(" ");
    const tag = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

    if (tag === "MEMFREE") {
      result.memFree = parseIntOrNull(rest);
    } else if (tag === "MAINSIZE") {
      result.mainSize = rest === "NA" ? null : parseIntOrNull(rest);
    } else if (tag === "CORESIZE") {
      result.coreSize = rest === "NA" ? null : parseIntOrNull(rest);
    } else if (tag === "COMPILE") {
      if (rest.startsWith("OK")) {
        result.compile = "OK";
      } else if (rest.startsWith("MEMORYERROR")) {
        result.compile = "MEMORYERROR";
      } else if (rest.startsWith("ERR")) {
        result.compile = "ERR";
        result.compileError = rest.slice(3).trim() || null;
      }
    } else if (tag === "BLE") {
      result.bleTested = true;
      if (rest.startsWith("OK")) {
        result.ble = "OK";
      } else if (rest.startsWith("MEMORYERROR")) {
        result.ble = "MEMORYERROR";
      } else if (rest.startsWith("ERR")) {
        result.ble = "ERR";
        result.bleError = rest.slice(3).trim() || null;
      }
    }
  }

  if (result.compile === "MEMORYERROR" || result.ble === "MEMORYERROR") {
    result.conclusion = "memory";
  } else if (result.done && result.compile === "OK" && (result.ble === "OK" || !result.bleTested)) {
    result.conclusion = "ok";
  } else {
    result.conclusion = "unknown";
  }

  return result;
}
