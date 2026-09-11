/**
 * Diagnóstico de memoria para ESP32 (runtime BLE) por USB / raw REPL.
 *
 * Solo lectura: no borra archivos ni reinicia la placa. Mide el camino real
 * `import pybot_ble` (no compile() del source) y una activación BLE básica.
 */

/**
 * Script MicroPython. Líneas parseables:
 *   MEMFREE_BEFORE <bytes>
 *   MAINSIZE <bytes|NA>
 *   CORESIZE <bytes|NA>
 *   MEMFREE_PREIMPORT <bytes>
 *   RUNTIME_IMPORT OK | MEMORYERROR | ERR <repr>
 *   MEMFREE_POSTIMPORT <bytes>
 *   BLE OK | MEMORYERROR | ERR <repr>
 *   MEMFREE_AFTER_BLE <bytes>
 *   DIAG_DONE
 */
export const MEMORY_DIAGNOSTIC_SCRIPT = [
  "import gc",
  "import sys",
  "import os",
  "gc.collect()",
  "print('MEMFREE_BEFORE', gc.mem_free())",
  "try:",
  "    print('MAINSIZE', os.stat('main.py')[6])",
  "except Exception:",
  "    print('MAINSIZE', 'NA')",
  "try:",
  "    print('CORESIZE', os.stat('pybot_ble.py')[6])",
  "except Exception:",
  "    print('CORESIZE', 'NA')",
  "try:",
  "    if 'pybot_ble' in sys.modules:",
  "        del sys.modules['pybot_ble']",
  "except Exception:",
  "    pass",
  "gc.collect()",
  "print('MEMFREE_PREIMPORT', gc.mem_free())",
  "try:",
  "    import pybot_ble",
  "    print('RUNTIME_IMPORT', 'OK')",
  "except MemoryError:",
  "    print('RUNTIME_IMPORT', 'MEMORYERROR')",
  "except Exception as e:",
  "    print('RUNTIME_IMPORT', 'ERR', repr(e))",
  "gc.collect()",
  "print('MEMFREE_POSTIMPORT', gc.mem_free())",
  "try:",
  "    pybot_ble = None",
  "except Exception:",
  "    pass",
  "try:",
  "    if 'pybot_ble' in sys.modules:",
  "        del sys.modules['pybot_ble']",
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
  "print('MEMFREE_AFTER_BLE', gc.mem_free())",
  "print('DIAG_DONE')",
].join("\n");

function parseIntOrNull(token) {
  const n = parseInt(token, 10);
  return Number.isNaN(n) ? null : n;
}

function parseStatus(rest) {
  if (rest.startsWith("OK")) return { status: "OK", error: null };
  if (rest.startsWith("MEMORYERROR")) return { status: "MEMORYERROR", error: null };
  if (rest.startsWith("ERR")) return { status: "ERR", error: rest.slice(3).trim() || null };
  return { status: null, error: null };
}

/**
 * @param {string} text
 * @returns {{
 *   memFreeBefore: number|null,
 *   memFreePreImport: number|null,
 *   memFreePostImport: number|null,
 *   memFreeAfterBle: number|null,
 *   memFree: number|null,
 *   mainSize: number|null,
 *   coreSize: number|null,
 *   runtimeImport: 'OK'|'MEMORYERROR'|'ERR'|null,
 *   runtimeImportError: string|null,
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
    memFreeBefore: null,
    memFreePreImport: null,
    memFreePostImport: null,
    memFreeAfterBle: null,
    memFree: null,
    mainSize: null,
    coreSize: null,
    runtimeImport: null,
    runtimeImportError: null,
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

    if (tag === "MEMFREE_BEFORE" || tag === "MEMFREE") {
      result.memFreeBefore = parseIntOrNull(rest);
    } else if (tag === "MEMFREE_PREIMPORT") {
      result.memFreePreImport = parseIntOrNull(rest);
    } else if (tag === "MEMFREE_POSTIMPORT") {
      result.memFreePostImport = parseIntOrNull(rest);
    } else if (tag === "MEMFREE_AFTER_BLE") {
      result.memFreeAfterBle = parseIntOrNull(rest);
    } else if (tag === "MAINSIZE") {
      result.mainSize = rest === "NA" ? null : parseIntOrNull(rest);
    } else if (tag === "CORESIZE") {
      result.coreSize = rest === "NA" ? null : parseIntOrNull(rest);
    } else if (tag === "RUNTIME_IMPORT" || tag === "COMPILE") {
      const parsed = parseStatus(rest);
      result.runtimeImport = parsed.status;
      result.runtimeImportError = parsed.error;
    } else if (tag === "BLE") {
      result.bleTested = true;
      const parsed = parseStatus(rest);
      result.ble = parsed.status;
      result.bleError = parsed.error;
    }
  }

  result.memFree = result.memFreeBefore;
  result.compile = result.runtimeImport;
  result.compileError = result.runtimeImportError;

  if (result.runtimeImport === "MEMORYERROR" || result.ble === "MEMORYERROR") {
    result.conclusion = "memory";
  } else if (result.done && result.runtimeImport === "OK" && result.ble === "OK") {
    result.conclusion = "ok";
  } else {
    result.conclusion = "unknown";
  }

  return result;
}
