/**
 * Errores estructurados del protocolo MicroPython / BLE Native REPL.
 * El código técnico viaja en `error.code` y `error.message`. La UI puede traducir
 * sin esconder el código original.
 */

export const PROTOCOL_ERROR = Object.freeze({
  BLE_REPL_CHARS_MISSING: "BLE_REPL_CHARS_MISSING",
  BLE_REPL_NOTIFY_FAIL: "BLE_REPL_NOTIFY_FAIL",
  BLE_REPL_HANDSHAKE_FAIL: "BLE_REPL_HANDSHAKE_FAIL",
  BLE_REPL_NEEDS_UPDATE: "BLE_REPL_NEEDS_UPDATE",
  RAW_REPL_ENTER_TIMEOUT: "RAW_REPL_ENTER_TIMEOUT",
  RAW_REPL_EXEC_ACK_BAD: "RAW_REPL_EXEC_ACK_BAD",
  RAW_REPL_CANCELLED: "RAW_REPL_CANCELLED",
  RAW_PASTE_HEADER_TIMEOUT: "RAW_PASTE_HEADER_TIMEOUT",
  RAW_PASTE_HEADER_BAD: "RAW_PASTE_HEADER_BAD",
  RAW_PASTE_WINDOW_TIMEOUT: "RAW_PASTE_WINDOW_TIMEOUT",
  RAW_PASTE_ABORTED: "RAW_PASTE_ABORTED",
  RAW_PASTE_EOF_TIMEOUT: "RAW_PASTE_EOF_TIMEOUT",
  RAW_REPL_STDOUT_TIMEOUT: "RAW_REPL_STDOUT_TIMEOUT",
  RAW_REPL_STDERR_TIMEOUT: "RAW_REPL_STDERR_TIMEOUT",
  BLE_REPL_RX_OVERFLOW: "BLE_REPL_RX_OVERFLOW",
  BLE_REPL_TX_FAIL: "BLE_REPL_TX_FAIL",
  BLE_REPL_NOT_CONNECTED: "BLE_REPL_NOT_CONNECTED",
  CLOSED: "CLOSED",
});

/**
 * @param {string} code
 * @param {{ detail?: string, cause?: unknown }} [extra]
 * @returns {Error}
 */
export function protocolError(code, extra = {}) {
  const name = String(code || "UNKNOWN");
  const detail = extra.detail ? String(extra.detail) : "";
  const err = new Error(detail ? name + ": " + detail : name);
  err.code = name;
  if (extra.cause !== undefined) err.cause = extra.cause;
  return err;
}

/** @param {unknown} e */
export function errorCode(e) {
  if (e && typeof e === "object" && e.code) return String(e.code);
  return String(e?.message ?? e ?? "UNKNOWN");
}
