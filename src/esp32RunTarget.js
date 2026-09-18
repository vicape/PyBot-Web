/**
 * Destino de ejecución para ESP32 MicroPython / EDA6.
 * Evita que APIs de hardware caigan en silencio a Pyodide por un pythonOnly obsoleto.
 */

/**
 * @param {{
 *   boardType: string,
 *   pythonOnly: boolean,
 *   needsHardware: boolean,
 *   canvasCode?: boolean,
 *   usbConnected: boolean,
 *   bleConnected: boolean,
 * }} opts
 * @returns {{
 *   target: "board" | "pyodide" | "needConnect" | "fallback",
 *   switchToHardwareMode: boolean,
 * }}
 */
export function resolveEsp32ExecutionTarget({
  boardType,
  pythonOnly,
  needsHardware,
  canvasCode = false,
  usbConnected,
  bleConnected,
}) {
  const isEsp32 =
    boardType === "esp32-micropython" || boardType === "esp32-eda6";
  if (!isEsp32 || canvasCode) {
    return { target: "fallback", switchToHardwareMode: false };
  }

  const boardConnected = Boolean(usbConnected || bleConnected);

  // APIs de hardware: NUNCA Pyodide. Con placa → board; sin placa → needConnect.
  if (needsHardware) {
    if (!boardConnected) {
      return { target: "needConnect", switchToHardwareMode: false };
    }
    return {
      target: "board",
      switchToHardwareMode: Boolean(pythonOnly),
    };
  }

  // Python puro: Solo Python → Pyodide; modo hardware → placa (si hay conexión).
  if (pythonOnly) {
    return { target: "pyodide", switchToHardwareMode: false };
  }
  if (!boardConnected) {
    return { target: "needConnect", switchToHardwareMode: false };
  }
  return { target: "board", switchToHardwareMode: false };
}
