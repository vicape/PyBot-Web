/**
 * Manifest for custom MicroPython + native Zigbee (uZigbee v1.6 PoC).
 * Mirror: firmware/pybot-c6-micropython-zigbee/manifest.json
 * Desired standalone Python hub path — NOT the interim native-only v2 coordinator.
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";
import { isValidatedZigbeePackaging } from "./zigbeeCoordinatorManifest.js";

export const MICROPYTHON_ZIGBEE_MANIFEST_PATH =
  "firmware/pybot-c6-micropython-zigbee/manifest.json";

export const MICROPYTHON_ZIGBEE_PROJECT_DIR =
  "firmware/pybot-c6-micropython-zigbee";

export const MICROPYTHON_ZIGBEE_MANIFEST = Object.freeze({
  manifestVersion: 1,
  id: "pybot-c6-micropython-zigbee",
  role: "micropython-zigbee-coordinator",
  board: "waveshare-esp32-c6-lcd-1.47",
  chipFamily: "esp32c6",
  mcu: "ESP32-C6FH4",
  flashMb: 4,
  psramMb: 0,
  firmwareVersion: "0.1.1-sc10-cmd",
  buildMarker: "SC10-CMD-CAPTURE",
  featureLabel: "SC10 command-capture (_uzigbee.on_command)",
  decision: "PIN_UZIGBEE_V1_6_AS_POC",
  zigbee: Object.freeze({
    spec: "Zigbee 3.x via ESP Zigbee SDK v1.6 / ZBOSS (uZigbee native _uzigbee)",
    deviceRole: "coordinator",
    nativeModule: "_uzigbee",
    pythonAdapter: "pybot.zigbee",
    hardwareValidation: "UNVERIFIED",
  }),
  toolchain: Object.freeze({
    espIdf: "v5.3.2",
    micropython: "v1.27.0",
    espZigbeeLib: "~1.6.0",
    espZbossLib: "~1.6.0",
    uzigbeeCommit: "ff25553c5fc9d59754eba9a89811e6433e0d4479",
    target: "esp32c6",
  }),
  coexistence: Object.freeze({
    micropythonSameImage: true,
    measuredFitOn4Mb: true,
    displayPlusZigbeeMeasured: false,
    interimNativeOnlyPath: "firmware/esp32c6-zigbee-coordinator/",
    reason:
      "Cloud rebuild with command-capture overlay produced multi-offset image fitting factory (86.45% / 3229264 bytes of 0x390000). ST7789+Zigbee heap/RAM coexistence still UNMEASURED on hardware. Guest static image published under public/firmware/c6-zigbee/ (0.1.1-sc10-cmd); prior 0.1.0 preserved at rollback-0.1.0/.",
  }),
  // Synced from firmware/pybot-c6-micropython-zigbee/manifest.json.
  // READY: installable multi-offset bins on guest static path; modeReady false until hardware boot proof.
  artifact: Object.freeze({
    status: "READY",
    blockReason: null,
    filename: "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin",
    sha256: "e9dcf6e9dcd09af29a8483584208086e0691a6964d6c85042a785967e0eb67aa",
    size: 3229264,
    flashOffset: 65536,
    builtAt: "2026-10-20T01:12:13Z",
    path: "../../public/firmware/c6-zigbee/pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin",
    packaging: "multi-offset",
    components: Object.freeze([
      Object.freeze({
        role: "bootloader",
        filename: "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-bootloader.bin",
        path: "../../public/firmware/c6-zigbee/pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-bootloader.bin",
        flashOffset: 0,
        sha256: "42d78bb1fcd180d12e64c4bd544ae260b6ab4bd2a4d385849395c6c8ab6038fa",
        size: 18384,
      }),
      Object.freeze({
        role: "partition-table",
        filename: "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-partition-table.bin",
        path: "../../public/firmware/c6-zigbee/pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-partition-table.bin",
        flashOffset: 32768,
        sha256: "b459f132d42af8ce0d3ffb047894135b9c2da262de2a85e4353e1bf84bab6e0f",
        size: 3072,
      }),
      Object.freeze({
        role: "app",
        filename: "pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin",
        path: "../../public/firmware/c6-zigbee/pybot-c6-micropython-zigbee-0.1.1-sc10-cmd-app.bin",
        flashOffset: 65536,
        sha256: "e9dcf6e9dcd09af29a8483584208086e0691a6964d6c85042a785967e0eb67aa",
        size: 3229264,
      }),
    ]),
    appOccupancyBytes: 3229264,
    factoryPartitionBytes: 3735552,
    heapRamMargins: null,
    printedVersions: Object.freeze({
      espIdf: "ESP-IDF v5.3.2",
      espIdfTagRequired: "v5.3.2",
      micropython: "v1.27.0",
      uzigbeeCommit: "ff25553c5fc9d59754eba9a89811e6433e0d4479",
      espZigbeeLib: "~1.6.0",
      espZbossLib: "~1.6.0",
    }),
  }),
  autoFlash: false,
  modeReady: false,
  restoreMicroPython: Object.freeze({
    imageId: "ESP32_GENERIC_C6",
    version: "1.27.0",
    url: "/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
    sha256: "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
  }),
});

export function loadMicropythonZigbeeManifest() {
  return MICROPYTHON_ZIGBEE_MANIFEST;
}

export function isMicropythonZigbeeSourcePresent() {
  return true;
}

/**
 * READY only with real sha + validated packaging. Never invent hashes.
 */
export function resolveMicropythonZigbeeArtifact(
  manifest = MICROPYTHON_ZIGBEE_MANIFEST,
) {
  const art = manifest?.artifact ?? {};
  const hashOk =
    typeof art.sha256 === "string" && /^[0-9a-f]{64}$/.test(art.sha256);
  const packagingOk = isValidatedZigbeePackaging(art);
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
    modeReady: false,
  };
}

export function describeMicropythonZigbeeReadiness(
  manifest = MICROPYTHON_ZIGBEE_MANIFEST,
) {
  const artifact = resolveMicropythonZigbeeArtifact(manifest);
  return {
    sourceReady: isMicropythonZigbeeSourcePresent(),
    artifact,
    hardwareValidation: "UNVERIFIED",
    capabilityStatus: CAPABILITY_STATUS.UNVERIFIED,
    micropythonSameImageIntent: true,
    measuredFitOn4Mb: false,
    modeReady: false,
    autoFlash: false,
    decision: manifest?.decision ?? null,
    toolchain: manifest?.toolchain ?? null,
    restoreMicroPython: manifest?.restoreMicroPython ?? null,
    interimNativeOnlyNotSubstitute: true,
  };
}

/**
 * Flash / mode selection only when artifact READY (still hardware UNVERIFIED).
 */
export function canSelectMicropythonZigbeeMode() {
  const ready = describeMicropythonZigbeeReadiness();
  return ready.sourceReady === true && ready.artifact.status === "READY";
}

export function canOfferMicropythonZigbeeFlash() {
  return canSelectMicropythonZigbeeMode() === true;
}

export function assertMicropythonZigbeeFlashExplicitOptIn(options = {}) {
  const explicit = options?.explicitOptIn === true;
  const acknowledgedErase = options?.acknowledgeErasesStockMicroPython === true;
  if (!canOfferMicropythonZigbeeFlash()) {
    return {
      allowed: false,
      reason:
        "MicroPython+Zigbee artifact is not READY; flash refused. Mode NOT READY.",
    };
  }
  if (!explicit || !acknowledgedErase) {
    return {
      allowed: false,
      reason:
        "Custom firmware flash requires explicitOptIn=true and acknowledgeErasesStockMicroPython=true. Auto-flash is forbidden.",
    };
  }
  return { allowed: true, reason: "ok" };
}
