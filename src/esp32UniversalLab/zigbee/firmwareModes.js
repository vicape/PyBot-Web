/**
 * Explicit C6 firmware runtime modes (M2A).
 * Default safe path remains stock MicroPython. Zigbee coordinator is opt-in
 * and only selectable for flash when a real artifact is READY.
 */

import { WAVESHARE_ESP32_C6_LCD_147_ID } from "../profiles/waveshareEsp32C6Lcd147.js";
import { ESP32_GENERIC_C6_FIRMWARE } from "../firmware/esp32GenericC6.js";
import {
  describeZigbeeCoordinatorReadiness,
  loadZigbeeCoordinatorManifest,
} from "./zigbeeCoordinatorManifest.js";

export const C6_FIRMWARE_MODE_MICROPYTHON = "micropython";
export const C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR = "zigbee-coordinator";

export const C6_FIRMWARE_MODES = Object.freeze([
  C6_FIRMWARE_MODE_MICROPYTHON,
  C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR,
]);

/** In-memory / test override. Browser callers may set via setC6FirmwareRuntimeMode. */
let runtimeModeOverride = null;

/**
 * @returns {string}
 */
export function getDefaultC6FirmwareMode() {
  return C6_FIRMWARE_MODE_MICROPYTHON;
}

/**
 * @param {string|null|undefined} mode
 */
export function setC6FirmwareRuntimeMode(mode) {
  if (mode == null) {
    runtimeModeOverride = null;
    return getC6FirmwareRuntimeMode();
  }
  const m = String(mode);
  if (!C6_FIRMWARE_MODES.includes(m)) {
    throw new Error(`Unknown C6 firmware mode: ${m}`);
  }
  if (m === C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR && !canSelectZigbeeCoordinatorMode()) {
    throw new Error(
      "Zigbee coordinator mode is not selectable until a READY firmware artifact exists. " +
        "Build with firmware/esp32c6-zigbee-coordinator/build.sh (ESP-IDF v5.5.4). " +
        "Default safe path remains MicroPython.",
    );
  }
  runtimeModeOverride = m;
  return runtimeModeOverride;
}

/**
 * @returns {string}
 */
export function getC6FirmwareRuntimeMode() {
  return runtimeModeOverride ?? getDefaultC6FirmwareMode();
}

/**
 * Clear override (tests / disconnect). Does not flash anything.
 */
export function clearC6FirmwareRuntimeMode() {
  runtimeModeOverride = null;
}

/**
 * Mode selection for Zigbee is gated on a real binary artifact.
 * Source-only / BLOCKED builds are documented but not selectable.
 */
export function canSelectZigbeeCoordinatorMode() {
  const ready = describeZigbeeCoordinatorReadiness();
  return ready.sourceReady === true && ready.artifact.status === "READY";
}

/**
 * Never auto-flash. Flash offer for Zigbee only when artifact READY.
 */
export function canOfferZigbeeCoordinatorFlash() {
  return canSelectZigbeeCoordinatorMode() === true;
}

/**
 * Flash offer for MicroPython restore remains the M1 validated path.
 */
export function canOfferMicroPythonRestoreFlash() {
  return (
    typeof ESP32_GENERIC_C6_FIRMWARE?.sha256 === "string" &&
    typeof ESP32_GENERIC_C6_FIRMWARE?.url === "string"
  );
}

/**
 * @param {string} [profileId]
 */
export function listC6FirmwareModeDescriptors(profileId = WAVESHARE_ESP32_C6_LCD_147_ID) {
  if (profileId !== WAVESHARE_ESP32_C6_LCD_147_ID) {
    return Object.freeze([]);
  }
  const zb = describeZigbeeCoordinatorReadiness();
  return Object.freeze([
    Object.freeze({
      id: C6_FIRMWARE_MODE_MICROPYTHON,
      label: "MicroPython (default safe path)",
      default: true,
      selectable: true,
      flashable: canOfferMicroPythonRestoreFlash(),
      autoFlash: false,
      replacesUserData: true,
      coexistsWithZigbee: false,
      note: "Official ESP32_GENERIC_C6 v1.27.0 — USB REPL, pybot modules, ST7789.",
    }),
    Object.freeze({
      id: C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR,
      label: "Native Zigbee coordinator (opt-in)",
      default: false,
      selectable: canSelectZigbeeCoordinatorMode(),
      flashable: canOfferZigbeeCoordinatorFlash(),
      autoFlash: false,
      replacesUserData: true,
      coexistsWithMicroPython: false,
      artifactStatus: zb.artifact.status,
      artifactBlockReason: zb.artifact.blockReason,
      warning:
        "Flashing Zigbee firmware ERASES MicroPython, pybot modules, and saved programs. " +
        "Restore via MicroPython mode using the official C6 image. Not auto-flashed.",
      note:
        zb.artifact.status === "READY"
          ? "Native ESP-IDF Zigbee 3.x coordinator with USB JSON control protocol."
          : `Source present; artifact BLOCKED (${zb.artifact.blockReason}).`,
    }),
  ]);
}

/**
 * When active mode is Zigbee, MicroPython REPL connect must not be claimed.
 * @returns {{ mode: string, micropythonPath: boolean, zigbeeControlPath: boolean, connectedClaim: 'micropython'|'zigbee-coordinator'|'none' }}
 */
export function resolveC6RuntimePathBoundary() {
  const mode = getC6FirmwareRuntimeMode();
  if (mode === C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR) {
    return {
      mode,
      micropythonPath: false,
      zigbeeControlPath: true,
      connectedClaim: "zigbee-coordinator",
    };
  }
  return {
    mode: C6_FIRMWARE_MODE_MICROPYTHON,
    micropythonPath: true,
    zigbeeControlPath: false,
    connectedClaim: "micropython",
  };
}

/**
 * Refuse silent overwrite: zigbee flash APIs must call this gate.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function assertZigbeeFlashExplicitOptIn(options = {}) {
  const explicit = options?.explicitOptIn === true;
  const acknowledgedErase = options?.acknowledgeErasesMicroPython === true;
  if (!canOfferZigbeeCoordinatorFlash()) {
    return {
      allowed: false,
      reason: "Zigbee coordinator artifact is not READY; flash refused.",
    };
  }
  if (!explicit || !acknowledgedErase) {
    return {
      allowed: false,
      reason:
        "Zigbee flash requires explicitOptIn=true and acknowledgeErasesMicroPython=true. Auto-flash is forbidden.",
    };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Snapshot for docs/tests.
 */
export function getC6FirmwareModeSnapshot() {
  const manifest = loadZigbeeCoordinatorManifest();
  return {
    defaultMode: getDefaultC6FirmwareMode(),
    activeMode: getC6FirmwareRuntimeMode(),
    modes: listC6FirmwareModeDescriptors(),
    zigbee: describeZigbeeCoordinatorReadiness(manifest),
    boundary: resolveC6RuntimePathBoundary(),
  };
}
