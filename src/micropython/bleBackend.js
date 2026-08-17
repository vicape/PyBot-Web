/**
 * Selección del backend de EJECUCIÓN BLE.
 *
 * Runtime 4.0.0 + capability native-repl → SOLO MicroPythonSession / BleReplTransport.
 * El camino LEGACY (BleRunSession / ProgramManager) no es un fallback silencioso:
 * solo se elige con flag técnico explícito o con un runtime que no declara native-repl.
 */

import { parseCapabilities } from "../bleProtocol.js";

export const BLE_BACKEND = Object.freeze({
  NATIVE_REPL: "NATIVE_REPL",
  LEGACY_RUN: "LEGACY_RUN",
});

function firmwareMajor(info) {
  const n = parseInt(String(info?.firmware ?? "").split(".")[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clasifica qué backend DEBE usarse, antes del handshake.
 * `nativeFlagEnabled === false` es el único override web (legado explícito).
 *
 * @param {{
 *   nativeFlagEnabled: boolean,
 *   info: object|null,
 *   hasReplChars: boolean,
 * }} input
 */
export function classifyBleRuntime(input) {
  const nativeFlagEnabled = input?.nativeFlagEnabled !== false;
  const info = input?.info ?? null;
  const hasReplChars = input?.hasReplChars === true;

  if (!nativeFlagEnabled) {
    return { intent: "legacy", reason: "explicit-legacy-flag" };
  }

  const caps = parseCapabilities(info);
  const nativeCap = caps.includes("native-repl");
  const major = firmwareMajor(info);
  const isV4 = major != null && major >= 4;

  if (nativeCap || isV4) {
    return { intent: "native", reason: "runtime-native-repl" };
  }
  if (hasReplChars && (info == null || caps.length === 0)) {
    return { intent: "native", reason: "repl-chars-present" };
  }
  if (info && !nativeCap && !isV4) {
    return { intent: "legacy", reason: "runtime-without-native-repl" };
  }
  return { intent: "fail", reason: "unverified", error: "BLE_REPL_UNVERIFIED" };
}

/**
 * Cierra la decisión con verificación REAL (chars + handshake).
 * Si el intent es native y algo falla, backend=null: NUNCA LEGACY_RUN.
 */
export function finalizeBleBackend(input) {
  const intent = input?.intent;
  const reason = input?.reason ?? null;
  if (intent === "legacy") {
    return {
      backend: BLE_BACKEND.LEGACY_RUN,
      reason,
      error: null,
    };
  }
  if (intent !== "native") {
    return {
      backend: null,
      reason,
      error: input?.error || "BLE_REPL_UNVERIFIED",
    };
  }
  if (input?.hasReplChars !== true) {
    return {
      backend: null,
      reason,
      error: "BLE_REPL_CHARS_MISSING",
    };
  }
  if (input?.notifications === false) {
    return {
      backend: null,
      reason,
      error: "BLE_REPL_NOTIFY_FAIL",
    };
  }
  if (input?.handshakeOk !== true) {
    return {
      backend: null,
      reason,
      error: input?.handshakeError || "BLE_REPL_HANDSHAKE_FAIL",
    };
  }
  return {
    backend: BLE_BACKEND.NATIVE_REPL,
    reason,
    error: null,
  };
}

/**
 * Plan de cableado: qué objetos crear. Testeable sin Web Bluetooth.
 * @returns {{ createBleRunSession: boolean, createMicroPythonSession: boolean, diag: object }}
 */
export function planBleExecutionBackend(input) {
  const classified = classifyBleRuntime(input);
  const diag = finalizeBleBackend({
    ...classified,
    hasReplChars: input?.hasReplChars === true,
    notifications: input?.notifications !== false,
    handshakeOk: input?.handshakeOk === true,
    handshakeError: input?.handshakeError,
  });
  return {
    createBleRunSession: diag.backend === BLE_BACKEND.LEGACY_RUN,
    createMicroPythonSession: diag.backend === BLE_BACKEND.NATIVE_REPL,
    diag,
  };
}

/**
 * Línea técnica única para consola / panel BLE.
 * @param {object} diag
 */
export function formatBleBackendDiagnosis(diag) {
  const d = diag && typeof diag === "object" ? diag : {};
  const backend = d.backend || "NONE";
  const parts = [
    "backend=" + backend,
    "runtime=" + (d.runtime ?? "?"),
    "protocol=" + (d.protocol ?? "?"),
    "native-repl=" + (d.nativeReplCap ? "true" : "false"),
    "chars=" +
      (d.replRx ? "REPL_RX" : "no-RX") +
      "," +
      (d.replTx ? "REPL_TX" : "no-TX"),
    "notify=" + (d.notifications ? "true" : "false"),
    "dupterm=" + (d.dupterm ? "true" : "false"),
    "handshake=" + (d.handshake ? "ok" : "fail"),
  ];
  if (d.reason) parts.push("reason=" + d.reason);
  if (d.error) parts.push("error=" + d.error);
  if (d.bindError) parts.push("bind=" + d.bindError);
  return "BLE " + parts.join(" ");
}
