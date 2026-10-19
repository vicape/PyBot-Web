/**
 * Exact, private firmware-build acceptance for the first physical ESP32-C6 bench.
 * Binaries stay outside Git and production. A user chooses the three files locally.
 * This module cannot auto-flash: only an explicit call with two confirmations can
 * enter WebSerial bootloader mode. Source alone never makes a firmware READY.
 */
import { isEsp32C6Chip } from "../firmware/esp32GenericC6.js";
import { WAVESHARE_ESP32_C6_LCD_147_ID } from "../profiles/waveshareEsp32C6Lcd147.js";
import { sha256Hex, connectC6Bootloader, writeC6MultiOffsetFirmware, resetC6AndRelease } from "./c6Flasher.js";

export const C6_ZIGBEE_BENCH_PACKAGE = Object.freeze({
  version: "0.1.0",
  board: WAVESHARE_ESP32_C6_LCD_147_ID,
  hardwareValidation: "UNVERIFIED",
  sourceCommit: "834a2ecd0ee648b3570d8c913f358d262b2a92ae",
  sourceArtifact: "https://github.com/vicape/cursor-control/actions/runs/39193349317/artifacts/12161052985",
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
  return {
    ok: true,
    segments,
    verifiedVersion: C6_ZIGBEE_BENCH_PACKAGE.version,
    hardwareValidation: "UNVERIFIED",
    autoFlash: false,
  };
}

/** This gate must be checked on the final human-triggered Flash action. */
export function assertC6ZigbeeBenchFlashConsent(options = {}) {
  if (!options.validated?.ok) return { allowed: false, reason: "BENCH_PACKAGE_NOT_VERIFIED" };
  if (options.profileId !== C6_ZIGBEE_BENCH_PACKAGE.board) {
    return { allowed: false, reason: "BENCH_WRONG_BOARD_PROFILE" };
  }
  if (options.connected === true) return { allowed: false, reason: "BENCH_DISCONNECT_FIRST" };
  if (options.backupConfirmed !== true) return { allowed: false, reason: "BENCH_BACKUP_REQUIRED" };
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
    await writeC6MultiOffsetFirmware(boot, validated.segments, { onProgress: options.onProgress });
    await resetC6AndRelease(boot);
  } catch (error) {
    await resetC6AndRelease(boot).catch(() => {});
    throw error;
  }
  options.onLog?.("PYBOT_C6_ZIGBEE:FLASH_WRITTEN — reboot + MicroPython REPL + LCD + Zigbee physical tests STILL REQUIRED.");
  return { written: true, physicallyVerified: false, hardwareValidation: "UNVERIFIED", modeReady: false };
}
