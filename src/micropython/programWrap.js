/**
 * Wrapper estructural de ejecución educativa.
 * Pre-run: limpieza completa. Finally: fin normal selectivo vs detención/error.
 */

export function indentPython(source) {
  return String(source ?? "")
    .split("\n")
    .map((line) => (line.length ? "    " + line : line))
    .join("\n");
}

/**
 * Limpieza explícita cuando el REPL está idle (Stop tras fin normal).
 * Cubre el namespace inlined (USB) y el módulo EDA6 (BLE / import).
 */
export const HELD_HARDWARE_RELEASE_SCRIPT = [
  "try:",
  "    detenerTodo()",
  "except Exception:",
  "    pass",
  "try:",
  "    import EDA6",
  "    EDA6.detenerTodo()",
  "except Exception:",
  "    pass",
  "try:",
  "    _pybot_cleanup()",
  "except Exception:",
  "    pass",
  "",
].join("\n");

/**
 * Envuelve el código del alumno para que hardware (PWM/salidas) quede seguro.
 * `detenerTodo`, `_pybot_cleanup` y `_pybot_cleanup_normal` son opcionales.
 * Fin normal: si existe `_pybot_cleanup_normal` (EDA6) se usa; si no, limpieza completa (GPIO).
 *
 * @param {string} userCode
 * @returns {string}
 */
export function wrapStudentExecution(userCode) {
  const body = indentPython(String(userCode ?? ""));
  return [
    "try:",
    "    detenerTodo()",
    "except Exception:",
    "    pass",
    "try:",
    "    _pybot_cleanup()",
    "except Exception:",
    "    pass",
    "def __pybot_main():",
    body || "    pass",
    "_pybot_ok = False",
    "try:",
    "    __pybot_main()",
    "    _pybot_ok = True",
    "finally:",
    "    if _pybot_ok:",
    "        try:",
    "            _pybot_cleanup_normal()",
    "        except Exception:",
    "            try:",
    "                detenerTodo()",
    "            except Exception:",
    "                pass",
    "            try:",
    "                _pybot_cleanup()",
    "            except Exception:",
    "                pass",
    "    else:",
    "        try:",
    "            detenerTodo()",
    "        except Exception:",
    "            pass",
    "        try:",
    "            _pybot_cleanup()",
    "        except Exception:",
    "            pass",
    "",
  ].join("\n");
}

/**
 * Combina prelude + código del alumno ya envuelto.
 * @param {string} prelude
 * @param {string} userCode
 */
export function buildRunnableProgram(prelude, userCode) {
  const prefix = prelude != null ? String(prelude) : "";
  return prefix + (prefix && !prefix.endsWith("\n") ? "\n" : "") + wrapStudentExecution(userCode);
}
