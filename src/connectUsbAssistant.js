/**
 * Asistente de conexión USB (modal). Desactivar = flujo legacy (conectar directo).
 * localStorage pybot_connect_assistant: "1" (default) | "0"
 */

const STORAGE_KEY = "pybot_connect_assistant";

/** @returns {boolean} */
export function isConnectAssistantEnabled() {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "0") return false;
  return true;
}

/** @param {boolean} enabled */
export function setConnectAssistantEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

/** Chequeos previos sin tocar el puerto USB. */
export function getUsbEnvironmentChecks() {
  const hasWebSerial = typeof navigator !== "undefined" && "serial" in navigator;
  const isSecure =
    typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : true;

  return [
    { id: "webSerial", ok: hasWebSerial },
    { id: "https", ok: isSecure },
  ];
}

/**
 * @param {string | undefined} rawMessage mensaje de error (PYBOT_USB:…)
 * @returns {"LIST_EMPTY" | "MISSING_BROWSER" | "HTTPS" | "PERMISSION" | "OTHER" | null}
 */
export function classifyConnectError(rawMessage) {
  const m = String(rawMessage ?? "");
  if (!m.startsWith("PYBOT_USB:")) return m ? "OTHER" : null;
  const code = m.slice("PYBOT_USB:".length);
  if (code === "LIST_EMPTY") return "LIST_EMPTY";
  if (code === "MISSING_BROWSER") return "MISSING_BROWSER";
  if (code === "HTTPS") return "HTTPS";
  if (code === "PERMISSION") return "PERMISSION";
  return "OTHER";
}

/** @param {string} boardType */
export function boardLabelKey(boardType) {
  if (boardType === "esp32-micropython") return "boardEsp32Mp";
  if (boardType === "esp32-eda6") return "boardEsp32Eda6";
  return "boardArduino";
}
