/**
 * Diagnóstico de SINTAXIS Python para el editor Monaco. Módulo NUEVO y AISLADO.
 *
 * - No ejecuta el programa: solo usa compile(src, "<pybot>", "exec") para
 *   detectar SyntaxError, sin correr el código del alumno.
 * - Usa su propia instancia de Pyodide cacheada (cargada bajo demanda). No toca
 *   pyodideRunner.js ni el runtime de ejecución.
 * - Si Pyodide no está disponible o algo falla, devuelve { ok: true } para no
 *   romper nada (no se marca error).
 */

let _pyodidePromise = null;

async function getDiagnosticsPyodide() {
  if (typeof globalThis.loadPyodide !== "function") return null;
  if (!_pyodidePromise) {
    _pyodidePromise = globalThis
      .loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/" })
      .catch((e) => {
        _pyodidePromise = null;
        throw e;
      });
  }
  try {
    return await _pyodidePromise;
  } catch {
    return null;
  }
}

const CHECKER_SRC = `
import json

def __pybot_check_syntax__(src):
    try:
        compile(src, "<pybot>", "exec")
        return json.dumps({"ok": True})
    except SyntaxError as e:
        line = e.lineno or 1
        col = e.offset or 1
        end_line = getattr(e, "end_lineno", None) or line
        end_col = getattr(e, "end_offset", None) or (col + 1)
        return json.dumps({
            "ok": False,
            "message": e.msg or "invalid syntax",
            "line": line,
            "column": col,
            "endLine": end_line,
            "endColumn": end_col,
        })
    except Exception:
        # Otros problemas de compilación (p. ej. bytes nulos): no marcamos.
        return json.dumps({"ok": True})
`;

let _checkerReady = false;

/**
 * Valida la sintaxis del código Python.
 * @param {string} source
 * @returns {Promise<{ ok: true } | { ok: false, message: string, line: number, column: number, endLine: number, endColumn: number }>}
 */
export async function checkPythonSyntax(source) {
  if (!source || !source.trim()) return { ok: true };

  const pyodide = await getDiagnosticsPyodide();
  if (!pyodide) return { ok: true };

  try {
    if (!_checkerReady) {
      pyodide.runPython(CHECKER_SRC);
      _checkerReady = true;
    }
    const fn = pyodide.globals.get("__pybot_check_syntax__");
    const raw = fn(source);
    if (fn?.destroy) {
      try {
        fn.destroy();
      } catch {
        /* ignore */
      }
    }
    const parsed = JSON.parse(raw);
    if (parsed.ok) return { ok: true };
    return {
      ok: false,
      message: String(parsed.message ?? "invalid syntax"),
      line: Math.max(1, Number(parsed.line) || 1),
      column: Math.max(1, Number(parsed.column) || 1),
      endLine: Math.max(1, Number(parsed.endLine) || Number(parsed.line) || 1),
      endColumn: Math.max(2, Number(parsed.endColumn) || (Number(parsed.column) || 1) + 1),
    };
  } catch {
    return { ok: true };
  }
}
