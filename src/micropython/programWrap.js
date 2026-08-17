/**
 * Wrapper estructural de ejecución educativa.
 * Cleanup en finally: ejecución normal, excepción, KeyboardInterrupt y nuevo Run.
 */

export function indentPython(source) {
  return String(source ?? "")
    .split("\n")
    .map((line) => (line.length ? "    " + line : line))
    .join("\n");
}

/**
 * Envuelve el código del alumno para que hardware (PWM/salidas) quede seguro.
 * `detenerTodo` y `_pybot_cleanup` son opcionales (NameError → ignore).
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
    "try:",
    "    __pybot_main()",
    "finally:",
    "    try:",
    "        detenerTodo()",
    "    except Exception:",
    "        pass",
    "    try:",
    "        _pybot_cleanup()",
    "    except Exception:",
    "        pass",
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
