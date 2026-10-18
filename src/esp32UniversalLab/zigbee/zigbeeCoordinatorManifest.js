/**
 * Versioned manifest for the C6 native Zigbee coordinator firmware target.
 * Browser-safe (no node:fs). Firmware tree mirror:
 * firmware/esp32c6-zigbee-coordinator/manifest.json — keep fields in sync via M2A tests.
 * Artifact SHA is only trusted when status === READY (never invent hashes).
 * READY requires validated packaging (merged-raw @ 0 or multi-offset with bootloader).
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
      "Interim opt-in: separate native Zigbee firmware is the reliable path today. Feasibility of a custom MicroPython+native Zigbee stack on 4MB, or a 2-board architecture (MicroPython UI + Zigbee radio), remains open pending flash/RAM measurements — not asserted as physically impossible. Stock MicroPython (~1.9MB) plus full ESP Zigbee SDK has not been measured to fit; this target does not fulfill the long-term same-board Python+Zigbee goal.",
    wifiBleWithZigbee:
      "Espressif documents multi-radio SoC capabilities; this M2A slice does not enable Wi-Fi SoftAP gateway or claim concurrent radio QA",
    thread: "Separate stack/role — deferred to M2B",
    architectures: Object.freeze({
      interimSeparateFirmware:
        "Current M2A path — opt-in full-flash Zigbee coordinator; restore MicroPython via M1 image",
      customMicropythonZigbee:
        "Possible future: trimmed MicroPython + native Zigbee binding — requires size measurements before claiming fit",
      twoBoard:
        "Possible future: MicroPython board for UI/logic + second C6 as Zigbee coordinator over UART/USB host protocol",
    }),
  }),
  artifact: Object.freeze({
    status: "BLOCKED",
    blockReason:
      "ESP-IDF v5.5.4 + esp-zigbee-lib toolchain not installed in this execution environment; binary produced only by firmware/esp32c6-zigbee-coordinator/build.sh when IDF is available (merged-raw or multi-offset bundle with bootloader)",
    filename: null,
    sha256: null,
    size: null,
    flashOffset: null,
    builtAt: null,
    path: null,
    packaging: null,
    components: null,
  }),
  license: Object.freeze({
    projectCode: "same as repository",
    espZigbeeLib:
      "Espressif prebuilt proprietary library via ESP Component Registry (espressif/esp-zigbee-lib); obtained at build time — not redistributed as source here",
    espIdf: "Apache-2.0 / Espressif",
  }),
  autoFlash: false,
  tuya: Object.freeze({
    standaloneZcl: "ZCL OnOff baseline only — separate from Smart Life",
    smartLifeOfficialGateway:
      "BLOCKED — requires Tuya PID/license/SDK; no vendor credentials hardcoded; no spoofing; Smart Life pairing not claimed",
  }),
  restoreMicroPython: Object.freeze({
    imageId: "ESP32_GENERIC_C6",
    version: "1.27.0",
    url: "/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
    sha256: "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
    note: "Re-flash official MicroPython to restore USB REPL + pybot modules + ST7789 path. Backup user main.py before any opt-in Zigbee flash.",
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
 * True when packaging is a validated flash layout (not app-only @ 0).
 * @param {object} art
 */
export function isValidatedZigbeePackaging(art) {
  if (!art || typeof art !== "object") return false;
  const packaging = art.packaging;
  const components = Array.isArray(art.components) ? art.components : [];
  const hasBootloader = components.some(
    (c) => c && c.role === "bootloader" && typeof c.flashOffset === "number",
  );
  const hasPartition = components.some(
    (c) => c && c.role === "partition-table" && typeof c.flashOffset === "number",
  );
  const hasApp = components.some(
    (c) => c && c.role === "app" && typeof c.flashOffset === "number",
  );

  if (packaging === "merged-raw") {
    // Merged image flashes at 0; must still prove bootloader was part of the build.
    return (
      art.flashOffset === 0 &&
      typeof art.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(art.sha256) &&
      typeof art.filename === "string" &&
      art.filename.length > 0 &&
      hasBootloader &&
      hasPartition &&
      hasApp
    );
  }
  if (packaging === "multi-offset") {
    // Multi-file: each component at official offset; never treat app-only @ 0 as READY.
    if (!(hasBootloader && hasPartition && hasApp)) return false;
    const app = components.find((c) => c.role === "app");
    if (app && app.flashOffset === 0 && !hasBootloader) return false;
    if (app && app.flashOffset === 0) return false; // app must not sit at 0 alone
    return true;
  }
  return false;
}

/**
 * Artifact is READY only when manifest says so with real sha + validated packaging.
 * Never invent hashes. Never READY for app-only image at flashOffset 0.
 * Binary file existence is verified in Node tests only.
 * @param {typeof ZIGBEE_COORDINATOR_MANIFEST} [manifest]
 */
export function resolveZigbeeCoordinatorArtifact(
  manifest = ZIGBEE_COORDINATOR_MANIFEST,
) {
  const art = manifest?.artifact ?? {};
  const hashOk =
    typeof art.sha256 === "string" && /^[0-9a-f]{64}$/.test(art.sha256);
  const packagingOk = isValidatedZigbeePackaging(art);
  // merged-raw carries primary sha; multi-offset may rely on component hashes
  const multiOk =
    art.packaging === "multi-offset" &&
    packagingOk &&
    Array.isArray(art.components) &&
    art.components.every(
      (c) =>
        c &&
        typeof c.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(c.sha256) &&
        typeof c.filename === "string",
    );
  const ready =
    art.status === "READY" &&
    packagingOk &&
    (art.packaging === "merged-raw" ? hashOk && !!art.filename : multiOk);

  return {
    status: ready ? "READY" : "BLOCKED",
    blockReason: ready
      ? null
      : art.blockReason ||
        (!packagingOk && art.status === "READY"
          ? "Artifact packaging invalid (need merged-raw or multi-offset with bootloader)"
          : "Toolchain/binary not available"),
    sha256: ready ? art.sha256 ?? null : null,
    filename: ready ? art.filename ?? null : null,
    size: ready ? art.size ?? null : null,
    path: ready ? art.path ?? null : null,
    flashOffset: ready ? art.flashOffset ?? null : null,
    packaging: ready ? art.packaging ?? null : null,
    components: ready ? art.components ?? null : null,
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
