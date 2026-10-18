/**
 * Versioned manifest for the C6 native Zigbee coordinator firmware target.
 * Browser-safe (no node:fs). Firmware tree mirror:
 * firmware/esp32c6-zigbee-coordinator/manifest.json — keep fields in sync via M2A tests.
 * Artifact SHA is only trusted when status === READY (never invent hashes).
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";

export const ZIGBEE_COORDINATOR_MANIFEST_PATH =
  "firmware/esp32c6-zigbee-coordinator/manifest.json";

export const ZIGBEE_COORDINATOR_PROJECT_DIR =
  "firmware/esp32c6-zigbee-coordinator";

/**
 * In-repo source-of-truth for Universal Lab runtime decisions.
 * When build.sh produces a binary it updates the JSON on disk; operators then
 * bump artifact fields here (or tests fail on drift).
 */
export const ZIGBEE_COORDINATOR_MANIFEST = Object.freeze({
  manifestVersion: 1,
  id: "pybot-esp32c6-zigbee-coordinator",
  role: "zigbee-coordinator",
  board: "waveshare-esp32-c6-lcd-1.47",
  chipFamily: "esp32c6",
  mcu: "ESP32-C6FH4",
  flashMb: 4,
  psramMb: 0,
  firmwareVersion: "0.1.0",
  zigbee: Object.freeze({
    spec: "Zigbee 3.x / ZCL v8 (Espressif ESP Zigbee SDK v2.x)",
    deviceRole: "coordinator",
    baselineClusters: Object.freeze([
      "basic",
      "identify",
      "on_off(client)",
    ]),
    commercialSwitchBaseline:
      "ZCL OnOff (0x0006) command on/off/toggle + attribute read 0x0000",
    securityDefault:
      "centralized (distributed security disabled); bounded permit-join",
    hardwareValidation: "UNVERIFIED",
  }),
  toolchain: Object.freeze({
    espIdf: "v5.5.4",
    espZigbeeLib: "~2.0.0",
    target: "esp32c6",
    docs: "https://docs.espressif.com/projects/esp-zigbee-sdk/en/latest/esp32c6/developing.html",
  }),
  coexistence: Object.freeze({
    micropythonSameImage: false,
    reason:
      "4MB flash cannot host stock MicroPython (~1.9MB) and ESP Zigbee stack in one image; modes are mutually exclusive opt-in full-flash targets",
    wifiBleWithZigbee:
      "Espressif documents multi-radio SoC capabilities; this M2A slice does not enable Wi-Fi SoftAP gateway or claim concurrent radio QA",
    thread: "Separate stack/role — deferred to M2B",
  }),
  artifact: Object.freeze({
    status: "BLOCKED",
    blockReason:
      "ESP-IDF v5.5.4 + esp-zigbee-lib toolchain not installed in this execution environment; binary produced only by firmware/esp32c6-zigbee-coordinator/build.sh when IDF is available",
    filename: null,
    sha256: null,
    size: null,
    flashOffset: 0,
    builtAt: null,
  }),
  license: Object.freeze({
    projectCode: "same as repository",
    espZigbeeLib:
      "Espressif prebuilt proprietary library via ESP Component Registry (espressif/esp-zigbee-lib); obtained at build time — not redistributed as source here",
    espIdf: "Apache-2.0 / Espressif",
  }),
  autoFlash: false,
  restoreMicroPython: Object.freeze({
    imageId: "ESP32_GENERIC_C6",
    version: "1.27.0",
    url: "/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
    sha256: "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
    note: "Re-flash official MicroPython to restore USB REPL + pybot modules + ST7789 path",
  }),
});

/**
 * @returns {typeof ZIGBEE_COORDINATOR_MANIFEST}
 */
export function loadZigbeeCoordinatorManifest() {
  return ZIGBEE_COORDINATOR_MANIFEST;
}

/**
 * Source tree is part of this repo (M2A). Browser cannot probe disk; treat as present.
 * @returns {boolean}
 */
export function isZigbeeCoordinatorSourcePresent() {
  return true;
}

/**
 * Artifact is READY only when manifest says so with a real sha256.
 * Never invent hashes. Binary file existence is verified in Node tests only.
 * @param {typeof ZIGBEE_COORDINATOR_MANIFEST} [manifest]
 */
export function resolveZigbeeCoordinatorArtifact(
  manifest = ZIGBEE_COORDINATOR_MANIFEST,
) {
  const art = manifest?.artifact ?? {};
  const ready =
    art.status === "READY" &&
    typeof art.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(art.sha256) &&
    typeof art.filename === "string" &&
    art.filename.length > 0;
  return {
    status: ready ? "READY" : "BLOCKED",
    blockReason: ready
      ? null
      : art.blockReason || "Toolchain/binary not available",
    sha256: ready ? art.sha256 : null,
    filename: ready ? art.filename : null,
    size: ready ? art.size : null,
    path: ready ? art.path ?? null : null,
    autoFlash: false,
  };
}

/**
 * @param {typeof ZIGBEE_COORDINATOR_MANIFEST} [manifest]
 */
export function describeZigbeeCoordinatorReadiness(
  manifest = ZIGBEE_COORDINATOR_MANIFEST,
) {
  const artifact = resolveZigbeeCoordinatorArtifact(manifest);
  return {
    sourceReady: isZigbeeCoordinatorSourcePresent(),
    artifact,
    hardwareValidation: "UNVERIFIED",
    capabilityStatus: CAPABILITY_STATUS.UNVERIFIED,
    micropythonCoexist: false,
    autoFlash: false,
    toolchain: manifest?.toolchain ?? null,
    restoreMicroPython: manifest?.restoreMicroPython ?? null,
  };
}
