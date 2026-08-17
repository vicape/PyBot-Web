/**
 * Switch técnico, centralizado y temporal del runtime BLE nativo.
 *
 * El alumno NO ve este control. Permite volver al runtime LEGACY
 * (ProgramManager + protocolo RUN) si una placa aún no tiene 4.0.
 *
 * Orden de resolución:
 *   1) globalThis.__PYBOT_NATIVE_BLE__ (tests / override de sesión)
 *   2) localStorage.pybot_native_ble ("0"/"false" desactiva → LEGACY explícito)
 *   3) MICROPYTHON_NATIVE_BLE (default true)
 *
 * En placa, el archivo `pybot_legacy.on` fuerza el bucle LEGACY (ProgramManager).
 * Nunca hay fallback automático 4.0 → ProgramManager.
 */

export const MICROPYTHON_NATIVE_BLE = true;

/**
 * @returns {boolean}
 */
export function isNativeBleEnabled() {
  try {
    const g = globalThis.__PYBOT_NATIVE_BLE__;
    if (g === true || g === false) return g;
  } catch {
    /* ignore */
  }
  try {
    const ls = globalThis.localStorage?.getItem("pybot_native_ble");
    if (ls === "0" || ls === "false") return false;
    if (ls === "1" || ls === "true") return true;
  } catch {
    /* ignore */
  }
  return MICROPYTHON_NATIVE_BLE === true;
}
