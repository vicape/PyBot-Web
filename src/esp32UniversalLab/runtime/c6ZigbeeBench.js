/**
 * TARGET: vicape/PyBot-Web (branch feature/esp32-universal-lab only).
 * Exact, private firmware-build acceptance for the first physical ESP32-C6 bench.
 * Guided "Preparar e instalar" flow: detect C6+4MB, verify pinned package, full 4 MB
 * backup to a user-saved file, explicit consent, then manual flash. Binaries stay
 * outside Git and production. Source alone never makes a firmware READY.
 * Full-image backup preserves on-device VFS paths /main.py, /boot.py, /pybot/assets.
 */
import { isEsp32C6Chip } from "../firmware/esp32GenericC6.js";
import { WAVESHARE_ESP32_C6_LCD_147_ID } from "../profiles/waveshareEsp32C6Lcd147.js";
import {
  sha256Hex,
  connectC6Bootloader,
  writeC6MultiOffsetFirmware,
  resetC6AndRelease,
  detectC6ChipAndFlashSize,
  readC6FullFlashBackup,
  saveC6BackupToUserFile,
  C6_FULL_FLASH_BYTES,
} from "./c6Flasher.js";

export { C6_FULL_FLASH_BYTES };

/** On-device VFS paths preserved inside the complete 4 MB flash backup image. */
export const C6_ZIGBEE_BENCH_PRESERVED_VFS_PATHS = Object.freeze([
  "/main.py",
  "/boot.py",
  "/pybot/assets",
]);

export const C6_ZIGBEE_BENCH_UI_LABEL = "Preparar e instalar";

export const C6_ZIGBEE_BENCH_PACKAGE = Object.freeze({
  version: "0.1.0",
  board: WAVESHARE_ESP32_C6_LCD_147_ID,
  hardwareValidation: "UNVERIFIED",
  sourceCommit: "834a2ecd0ee648b3570d8c913f358d262b2a92ae",
  /** Provenance pointer only — never used as a browser fetch URL. */
  sourceArtifact: "https://github.com/vicape/cursor-control/actions/runs/39193349317/artifacts/12161052985",
  pinnedRunId: "39193349317",
  pinnedArtifactId: "12161052985",
  autoFlash: false,
  publicReady: false,
  components: Object.freeze([
    Object.freeze({
      role: "bootloader",
      name: "pybot-c6-micropython-zigbee-0.1.0-bootloader.bin",
      address: 0x0,
      size: 18384,
      sha256: "8eed4217cf16bb74313615a6a7fb9a90a4ae79c05b828dfa923e84b0f574fbe6",
    }),
    Object.freeze({
      role: "partition-table",
      name: "pybot-c6-micropython-zigbee-0.1.0-partition-table.bin",
      address: 0x8000,
      size: 3072,
      sha256: "b459f132d42af8ce0d3ffb047894135b9c2da262de2a85e4353e1bf84bab6e0f",
    }),
    Object.freeze({
      role: "app",
      name: "pybot-c6-micropython-zigbee-0.1.0-app.bin",
      address: 0x10000,
      size: 3221280,
      sha256: "d22d48f5c474f327be4b946dfa88af49523606215dda5e74325a5864189ef096",
    }),
  ]),
});

/**
 * Automatic browser fetch of the private #555 artifact is not supported securely
 * with existing infrastructure. Exact product token for operators/Maxwell.
 */
export const C6_ZIGBEE_BENCH_DISTRIBUTION = Object.freeze({
  status: "DECISION REQUIRED",
  automaticFetchSupported: false,
  authorizedEndpointSupported: false,
  pinnedRunId: C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId,
  pinnedArtifactId: C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId,
  blockers: Object.freeze([
    "No access-controlled authorized firmware API exists in this repo (api/ has no artifact proxy).",
    "GitHub Actions artifacts are private, authenticated, and expiring; frontend must never embed a GitHub PAT, Actions credentials, service-role secrets, or a transient artifact URL.",
    "esp-zboss-lib proprietary terms — do not publish/redistribute the Zigbee-containing binaries until redistribution is cleared (see firmware/pybot-c6-micropython-zigbee/LICENSE_ATTRIBUTION.md and package THIRD_PARTY_NOTICES).",
  ]),
  alternatives: Object.freeze([
    "A: Add a private authorized backend endpoint (operator auth) that streams pinned artifact 12161052985 from run 39193349317 without exposing credentials to the browser, after zboss redistribution clearance.",
    "B: Host the verified package in an access-controlled private object store; issue short-lived signed URLs from that backend (same license gate).",
    "C (interim truthful path): Operator downloads the private artifact via authenticated GitHub access and loads the three verified .bin files into this guided flow — no public publish, no simulated automatic fetch.",
  ]),
});

/** Post-flash operator checklist. Zigbee pairing/dual-channel stay UNVERIFIED. */
export const C6_ZIGBEE_BENCH_POST_FLASH_CHECKS = Object.freeze([
  Object.freeze({ id: "micropython-repl", label: "MicroPython REPL boots", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "uzigbee-import", label: "_uzigbee import", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "st7789", label: "screen ST7789", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "gpio", label: "GPIO", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "wifi", label: "Wi-Fi", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "ble", label: "BLE", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "zigbee-pairing", label: "Zigbee pairing", status: "UNVERIFIED" }),
  Object.freeze({
    id: "zigbee-dual-onoff",
    label: "Zigbee dual channel ON/OFF",
    status: "UNVERIFIED",
  }),
]);

/**
 * Honest resolver for package acquisition. Never simulates a successful automatic fetch.
 * @returns {{ status: string, automaticFetchSupported: boolean, authorizedEndpointSupported: boolean, blockers: readonly string[], alternatives: readonly string[] }}
 */
export function resolveC6ZigbeeBenchPackageFetch() {
  return {
    status: C6_ZIGBEE_BENCH_DISTRIBUTION.status,
    automaticFetchSupported: false,
    authorizedEndpointSupported: false,
    blockers: C6_ZIGBEE_BENCH_DISTRIBUTION.blockers,
    alternatives: C6_ZIGBEE_BENCH_DISTRIBUTION.alternatives,
    pinnedRunId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedRunId,
    pinnedArtifactId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedArtifactId,
  };
}

/**
 * Verify a trusted manifest's pinned package, byte lengths and ALL SHA-256
 * hashes before opening any serial device. Never trust arbitrary layouts.
 * @param {Iterable<{name:string,arrayBuffer:Function,size?:number}>} files
 * @param {{digest?:Function}} options
 */
export async function validateC6ZigbeeBenchFiles(files, options = {}) {
  const selected = Array.from(files || []);
  if (selected.length !== 3) return { ok: false, reason: "BENCH_NEED_EXACTLY_THREE_BIN_FILES" };
  const expected = C6_ZIGBEE_BENCH_PACKAGE.components;
  const names = new Set();
  const segments = [];
  for (const spec of expected) {
    const file = selected.find((f) => f && f.name === spec.name);
    if (!file || names.has(spec.name)) {
      return { ok: false, reason: "BENCH_FILE_MISSING_OR_WRONG:" + spec.name };
    }
    names.add(spec.name);
    if (file.size !== spec.size || typeof file.arrayBuffer !== "function") {
      return { ok: false, reason: "BENCH_SIZE_MISMATCH:" + spec.role };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== spec.size) {
      return { ok: false, reason: "BENCH_READ_SIZE_MISMATCH:" + spec.role };
    }
    const hash = await (options.digest || sha256Hex)(bytes);
    if (hash !== spec.sha256) {
      return { ok: false, reason: "BENCH_SHA256_MISMATCH:" + spec.role };
    }
    segments.push({ role: spec.role, address: spec.address, data: bytes });
  }
  if (selected.some((f) => !names.has(f?.name))) {
    return { ok: false, reason: "BENCH_EXTRA_OR_UNKNOWN_FILE" };
  }
  // Reject app-only / wrong-offset packaging: all three pinned offsets required.
  if (
    segments[0]?.address !== 0x0 ||
    segments[1]?.address !== 0x8000 ||
    segments[2]?.address !== 0x10000
  ) {
    return { ok: false, reason: "BENCH_OFFSET_MISMATCH" };
  }
  return {
    ok: true,
    segments,
    verifiedVersion: C6_ZIGBEE_BENCH_PACKAGE.version,
    hardwareValidation: "UNVERIFIED",
    autoFlash: false,
  };
}

/**
 * Detect actual ESP32-C6 + 4 MB flash. Install must not proceed when this fails.
 */
export async function detectC6ZigbeeBenchTarget(options = {}) {
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("BENCH_HTTPS_REQUIRED");
  }
  const requestPort = options.requestPort || (() => {
    if (typeof navigator === "undefined" || !navigator.serial?.requestPort) {
      throw new Error("BENCH_WEBSERIAL_REQUIRED");
    }
    return navigator.serial.requestPort();
  });
  const port = await requestPort();
  const boot = await connectC6Bootloader(port, { onLog: options.onLog });
  try {
    const detection = await detectC6ChipAndFlashSize(boot);
    if (!detection.ok) {
      await resetC6AndRelease(boot).catch(() => {});
      return detection;
    }
    await resetC6AndRelease(boot);
    return {
      ok: true,
      chipName: detection.chipName,
      flashSize: detection.flashSize,
      flashBytes: detection.flashBytes,
    };
  } catch (error) {
    await resetC6AndRelease(boot).catch(() => {});
    throw error;
  }
}

/**
 * Full 4 MB backup to a USER-SAVED local file before any erase/write.
 * Never claims backup completed merely because it was requested.
 */
export async function backupC6ZigbeeBenchFlash(options = {}) {
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("BENCH_HTTPS_REQUIRED");
  }
  const requestPort = options.requestPort || (() => {
    if (typeof navigator === "undefined" || !navigator.serial?.requestPort) {
      throw new Error("BENCH_WEBSERIAL_REQUIRED");
    }
    return navigator.serial.requestPort();
  });
  const port = await requestPort();
  const boot = await connectC6Bootloader(port, { onLog: options.onLog });
  try {
    const detection = await detectC6ChipAndFlashSize(boot);
    if (!detection.ok) {
      await resetC6AndRelease(boot).catch(() => {});
      return { ok: false, reason: detection.reason, detection };
    }
    const read = await readC6FullFlashBackup(boot, { onProgress: options.onProgress });
    await resetC6AndRelease(boot);
    const saved = await saveC6BackupToUserFile(read.bytes, {
      suggestedName: options.suggestedName,
      showSaveFilePicker: options.showSaveFilePicker,
      document: options.document,
    });
    const verified =
      read.ok === true &&
      read.byteLength === C6_FULL_FLASH_BYTES &&
      saved.ok === true &&
      saved.byteLength === C6_FULL_FLASH_BYTES;
    return {
      ok: verified,
      reason: verified ? "ok" : "BENCH_BACKUP_INCOMPLETE",
      byteLength: read.byteLength,
      fileName: saved.fileName,
      downloadConfirmed: saved.downloadConfirmed === true,
      method: saved.method,
      limitation: saved.limitation || null,
      preservesViaFullImage: C6_ZIGBEE_BENCH_PRESERVED_VFS_PATHS,
      detection,
    };
  } catch (error) {
    await resetC6AndRelease(boot).catch(() => {});
    throw error;
  }
}

/** This gate must be checked on the final human-triggered Flash action. */
export function assertC6ZigbeeBenchFlashConsent(options = {}) {
  if (!options.validated?.ok) return { allowed: false, reason: "BENCH_PACKAGE_NOT_VERIFIED" };
  if (options.profileId !== C6_ZIGBEE_BENCH_PACKAGE.board) {
    return { allowed: false, reason: "BENCH_WRONG_BOARD_PROFILE" };
  }
  if (options.connected === true) return { allowed: false, reason: "BENCH_DISCONNECT_FIRST" };
  if (options.detection?.ok !== true || options.detection?.flashSize !== "4MB") {
    return { allowed: false, reason: "BENCH_DETECTION_REQUIRED" };
  }
  if (!isEsp32C6Chip(options.detection?.chipName)) {
    return { allowed: false, reason: "BENCH_CHIP_NOT_ESP32_C6" };
  }
  const backup = options.backupResult;
  if (
    !backup ||
    backup.ok !== true ||
    backup.byteLength !== C6_FULL_FLASH_BYTES
  ) {
    return { allowed: false, reason: "BENCH_BACKUP_REQUIRED" };
  }
  if (backup.downloadConfirmed !== true && options.backupDownloadAcknowledged !== true) {
    return { allowed: false, reason: "BENCH_BACKUP_DOWNLOAD_ACK_REQUIRED" };
  }
  if (options.eraseAcknowledged !== true) return { allowed: false, reason: "BENCH_ERASE_ACK_REQUIRED" };
  if (options.secondConfirmation !== "ESP32-C6") {
    return { allowed: false, reason: "BENCH_SECOND_CONFIRMATION_REQUIRED" };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * User-initiated physical operation only. Validation + consent precede a
 * requestPort() gesture; the connected chip is verified again by the bootloader.
 */
export async function flashC6ZigbeeBenchPackage(validated, options = {}) {
  const gate = assertC6ZigbeeBenchFlashConsent({ ...options, validated });
  if (!gate.allowed) throw new Error(gate.reason);
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new Error("BENCH_HTTPS_REQUIRED");
  }
  const requestPort = options.requestPort || (() => {
    if (typeof navigator === "undefined" || !navigator.serial?.requestPort) {
      throw new Error("BENCH_WEBSERIAL_REQUIRED");
    }
    return navigator.serial.requestPort();
  });
  const port = await requestPort();
  const boot = await connectC6Bootloader(port, { onLog: options.onLog });
  if (!isEsp32C6Chip(boot.chipName) && !isEsp32C6Chip(boot.chip?.CHIP_NAME)) {
    await resetC6AndRelease(boot).catch(() => {});
    throw new Error("BENCH_CHIP_NOT_ESP32_C6");
  }
  try {
    const detection = await detectC6ChipAndFlashSize(boot);
    if (!detection.ok) {
      await resetC6AndRelease(boot).catch(() => {});
      throw new Error(detection.reason || "BENCH_DETECTION_REQUIRED");
    }
    await writeC6MultiOffsetFirmware(boot, validated.segments, { onProgress: options.onProgress });
    await resetC6AndRelease(boot);
  } catch (error) {
    await resetC6AndRelease(boot).catch(() => {});
    throw error;
  }
  options.onLog?.("PYBOT_C6_ZIGBEE:FLASH_WRITTEN — reboot + MicroPython REPL + LCD + Zigbee physical tests STILL REQUIRED.");
  return {
    written: true,
    physicallyVerified: false,
    hardwareValidation: "UNVERIFIED",
    modeReady: false,
    postFlashChecks: C6_ZIGBEE_BENCH_POST_FLASH_CHECKS,
  };
}
