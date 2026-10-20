/**
 * TARGET: vicape/PyBot-Web (branch feature/esp32-universal-lab only).
 * Exact firmware-build acceptance for the first physical ESP32-C6 bench.
 * Same UX simplicity as stock "Instalar MicroPython (C6)": one "Instalar firmware"
 * CTA fetches+verifies the pinned package from static same-origin
 * /firmware/c6-zigbee/*.bin (vendored like stock C6), then WebSerial flash with
 * chip/4MB checks. No login, env secrets, ZIP, backup picker, or multi-stage
 * confirmation. CTA click = erase consent (apps/files may be wiped).
 * autoFlash remains false; hardwareValidation stays UNVERIFIED.
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

export const C6_ZIGBEE_BENCH_UI_LABEL = "Instalar firmware";
export const C6_ZIGBEE_BENCH_FETCH_ACTION = "Obtener firmware y verificar";
/** @deprecated No intermediate Continuar step; kept for import compatibility. */
export const C6_ZIGBEE_BENCH_CONTINUE_LABEL = "Continuar";
/** @deprecated Legacy API path; guest install uses static /firmware/c6-zigbee/ URLs. */
export const C6_ZIGBEE_BENCH_FIRMWARE_API = "/api/c6-zigbee-bench-firmware";
/** Static asset base (same pattern as /firmware/micropython/ for stock C6). */
export const C6_ZIGBEE_BENCH_STATIC_BASE = "/firmware/c6-zigbee";

/** Ordered progress stages for the one-click installer (status only — not buttons). */
export const C6_ZIGBEE_BENCH_PROGRESS_STAGES = Object.freeze([
  Object.freeze({ id: "fetch", es: "Firmware", en: "Firmware" }),
  Object.freeze({ id: "flash", es: "Instalación", en: "Install" }),
]);

/**
 * @deprecated Static public assets replace operator secret setup for guest install.
 * Kept for import compatibility; never emitted by the static fetch path.
 */
export const C6_ZIGBEE_BENCH_OPERATOR_SETUP =
  "OPERATOR_SETUP obsolete: guest Zigbee firmware is served from static /firmware/c6-zigbee/ (no Preview secrets).";

/**
 * @deprecated Product owner authorized anonymous guest delivery. Kept as empty
 * sentinel so older imports do not break; never emitted as a fetch blocker.
 * Prior internal "operator approval required" policy is superseded — approval
 * IS THIS ORDER (owner explicit publish authorization for test/preview branch).
 */
export const C6_ZIGBEE_BENCH_GUEST_APPROVAL_BLOCKER = "";

/** Bundled notice summary shown without login or extra confirmation. */
export const C6_ZIGBEE_BENCH_NOTICES = Object.freeze({
  path: "public/firmware/c6-zigbee/THIRD_PARTY_NOTICES.md",
  /** HTTP-accessible notices (same-origin static asset). */
  apiPath: `${C6_ZIGBEE_BENCH_STATIC_BASE}/THIRD_PARTY_NOTICES.md`,
  restrictions: Object.freeze([
    "esp-zboss-lib: retain copyright, conditions, and disclaimer; no reverse-engineering / decompile / modify / disassemble.",
    "esp-zigbee-lib: Apache-2.0 — retain license attributions.",
    "uZigbee: MIT — retain copyright and permission notice.",
    "Pinned ESP32-C6 image via static /firmware/c6-zigbee/; no proprietary .a libs or credentials.",
  ]),
});

export const C6_ZIGBEE_BENCH_PACKAGE = Object.freeze({
  /** Guest installer package id — SC10 native APS-capture (_uzigbee.on_aps). */
  version: "0.1.2-sc10-aps",
  /** Unambiguous UI/manifest marker for the APS-capture build. */
  buildMarker: "SC10-APS-CAPTURE",
  featureLabel: "SC10 APS-capture (_uzigbee.on_aps)",
  board: WAVESHARE_ESP32_C6_LCD_147_ID,
  chip: "ESP32-C6",
  hardwareValidation: "UNVERIFIED",
  sourceCommit: "12cc9dc828e726b6467fe16c2e1e594ea59248b1",
  /** Provenance: one bounded cloud rebuild from pinned build.sh + SC10 APS overlay. */
  sourceArtifact: "firmware/pybot-c6-micropython-zigbee/build-artifact/",
  pinnedRunId: "sc10-aps-rebuild-20261020",
  pinnedArtifactId: "build-artifact-0.1.2-sc10-aps",
  builtAt: "2026-10-20T02:28:01Z",
  rollbackPath: "public/firmware/c6-zigbee/rollback-0.1.1/",
  autoFlash: false,
  publicReady: false,
  noticesPath: "public/firmware/c6-zigbee/THIRD_PARTY_NOTICES.md",
  durableManifestPath: "firmware/pybot-c6-micropython-zigbee/private-bench-manifest.json",
  staticBase: C6_ZIGBEE_BENCH_STATIC_BASE,
  components: Object.freeze([
    Object.freeze({
      role: "bootloader",
      name: "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-bootloader.bin",
      url: `${C6_ZIGBEE_BENCH_STATIC_BASE}/pybot-c6-micropython-zigbee-0.1.2-sc10-aps-bootloader.bin`,
      address: 0x0,
      size: 18384,
      sha256: "ea5213729ebcb21541ec34aef195961ecd049f85183390b406d3cb42a4d5a837",
    }),
    Object.freeze({
      role: "partition-table",
      name: "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-partition-table.bin",
      url: `${C6_ZIGBEE_BENCH_STATIC_BASE}/pybot-c6-micropython-zigbee-0.1.2-sc10-aps-partition-table.bin`,
      address: 0x8000,
      size: 3072,
      sha256: "b459f132d42af8ce0d3ffb047894135b9c2da262de2a85e4353e1bf84bab6e0f",
    }),
    Object.freeze({
      role: "app",
      name: "pybot-c6-micropython-zigbee-0.1.2-sc10-aps-app.bin",
      url: `${C6_ZIGBEE_BENCH_STATIC_BASE}/pybot-c6-micropython-zigbee-0.1.2-sc10-aps-app.bin`,
      address: 0x10000,
      size: 3236944,
      sha256: "f18811848746fcd5ec3c4c44c714033f6dd1ae67cd5c3951376d27571f073ee2",
    }),
  ]),
});

/**
 * Automatic delivery via static same-origin assets (stock C6 pattern).
 * License: esp-zboss-lib permits binary redistribution with notice retention;
 * product owner authorizes guest delivery of the pinned package.
 */
export const C6_ZIGBEE_BENCH_DISTRIBUTION = Object.freeze({
  status: "STATIC_PUBLIC",
  automaticFetchSupported: true,
  authorizedEndpointSupported: false,
  guestAnonymousSupported: true,
  endpointPath: C6_ZIGBEE_BENCH_STATIC_BASE,
  fetchActionLabel: C6_ZIGBEE_BENCH_FETCH_ACTION,
  pinnedRunId: C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId,
  pinnedArtifactId: C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId,
  operatorSetup: C6_ZIGBEE_BENCH_OPERATOR_SETUP,
  licensePolicy:
    "Guest anonymous delivery of pinned ESP32-C6 image authorized via static /firmware/c6-zigbee/. THIRD_PARTY_NOTICES include esp-zboss-lib conditions (retain copyright/disclaimer; no reverse-engineering).",
});
/** Post-flash operator checklist. Zigbee pairing/dual-channel stay UNVERIFIED. */
export const C6_ZIGBEE_BENCH_POST_FLASH_CHECKS = Object.freeze([
  Object.freeze({ id: "micropython-repl", label: "MicroPython REPL boots", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "uzigbee-import", label: "_uzigbee import", status: "OPERATOR_CHECK" }),
  Object.freeze({ id: "st7789", label: "LCD ST7789 172×320", status: "OPERATOR_CHECK" }),
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
 * Resolver for package acquisition UI. Automatic anonymous static fetch is the
 * product flow; users see obtain/verify status, never a guest-policy popup.
 */
export function resolveC6ZigbeeBenchPackageFetch() {
  return {
    status: C6_ZIGBEE_BENCH_DISTRIBUTION.status,
    automaticFetchSupported: true,
    authorizedEndpointSupported: false,
    guestAnonymousSupported: true,
    endpointPath: C6_ZIGBEE_BENCH_DISTRIBUTION.endpointPath,
    fetchActionLabel: C6_ZIGBEE_BENCH_FETCH_ACTION,
    operatorSetup: C6_ZIGBEE_BENCH_OPERATOR_SETUP,
    pinnedRunId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedRunId,
    pinnedArtifactId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedArtifactId,
    licensePolicy: C6_ZIGBEE_BENCH_DISTRIBUTION.licensePolicy,
    notices: C6_ZIGBEE_BENCH_NOTICES,
  };
}

/**
 * Verify pinned package bytes (from server tickets or File-like objects).
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
 * Anonymous (guest) static fetch of the three verified segments + client SHA check.
 * Same architecture as stock C6 (/firmware/micropython/...): same-origin GET,
 * size + SHA-256 verify, then existing writeC6MultiOffsetFirmware.
 * No login, env secrets, API mint, ZIP, or file picker.
 * @param {{getAccessToken?:Function, fetchImpl?:Function, onProgress?:Function, signal?:AbortSignal, digest?:Function}} options
 */
export async function fetchAndValidateC6ZigbeeBenchPackage(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "BENCH_FETCH_UNAVAILABLE" };
  }
  // Optional token ignored for gating — static guest path needs no session.
  if (typeof options.getAccessToken === "function") {
    try {
      await options.getAccessToken();
    } catch {
      /* ignore — anonymous path does not require a session */
    }
  }
  const components = C6_ZIGBEE_BENCH_PACKAGE.components;
  const files = [];
  const total = components.length;
  for (let i = 0; i < total; i++) {
    const spec = components[i];
    options.onProgress?.({
      phase: "download",
      role: spec.role,
      pct: 10 + Math.round(((i + 0.5) / total) * 70),
    });
    let segRes;
    try {
      segRes = await fetchImpl(spec.url, {
        method: "GET",
        signal: options.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, reason: "BENCH_FETCH_INTERRUPTED" };
      return { ok: false, reason: "BENCH_FETCH_NETWORK", detail: String(e?.message || e) };
    }
    if (!segRes.ok) {
      return { ok: false, reason: "BENCH_SEGMENT_FETCH_FAILED", detail: spec.role };
    }
    const buf = await segRes.arrayBuffer();
    files.push({
      name: spec.name,
      size: buf.byteLength,
      arrayBuffer: async () => buf,
    });
  }
  options.onProgress?.({ phase: "verify", pct: 90 });
  const validated = await validateC6ZigbeeBenchFiles(files, { digest: options.digest });
  if (!validated.ok) return validated;
  options.onProgress?.({ phase: "done", pct: 100 });
  return {
    ...validated,
    source: "static-public",
    packageVersion: C6_ZIGBEE_BENCH_PACKAGE.version,
    notices: C6_ZIGBEE_BENCH_NOTICES,
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
 * Optional full 4 MB backup helper (not part of the install UX; install no longer
 * requires backup). Never claims backup completed merely because it was requested.
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

/** Human-readable gate codes for the compact installer UI (never invent success). */
export const C6_ZIGBEE_BENCH_GATE_MESSAGES = Object.freeze({
  BENCH_PACKAGE_NOT_VERIFIED: {
    es: "El firmware aún no está verificado. Usá Instalar firmware.",
    en: "Firmware is not verified yet. Use Instalar firmware.",
  },
  BENCH_AUTH_DENIED: {
    es: "El servidor rechazó la solicitud de firmware.",
    en: "The server rejected the firmware request.",
  },
  BENCH_CHIP_DENIED: {
    es: "Solo se entrega firmware fijado para ESP32-C6.",
    en: "Only the pinned ESP32-C6 firmware is delivered.",
  },
  BENCH_OPERATOR_SETUP_REQUIRED: {
    es: "Firmware estático no disponible en /firmware/c6-zigbee/.",
    en: "Static firmware unavailable under /firmware/c6-zigbee/.",
  },
  BENCH_SEGMENT_FETCH_FAILED: {
    es: "No se pudo descargar un segmento del firmware.",
    en: "Could not download a firmware segment.",
  },
  BENCH_FETCH_INTERRUPTED: {
    es: "Descarga interrumpida. Reintentá Instalar firmware.",
    en: "Download interrupted. Retry Instalar firmware.",
  },
  BENCH_SERVER_HASH_MISMATCH: {
    es: "El paquete del servidor no coincide con el manifesto anclado.",
    en: "Server package does not match the pinned manifest.",
  },
  BENCH_WRONG_BOARD_PROFILE: {
    es: "Seleccioná Waveshare ESP32-C6-LCD-1.47 en Placa.",
    en: "Select Waveshare ESP32-C6-LCD-1.47 in Board.",
  },
  BENCH_DISCONNECT_FIRST: {
    es: "Desconectá la placa del IDE antes de instalar.",
    en: "Disconnect the board from the IDE before installing.",
  },
  BENCH_DETECTION_REQUIRED: {
    es: "No se detectó una placa compatible con flash de 4 MB.",
    en: "No compatible board with 4 MB flash was detected.",
  },
  BENCH_CHIP_NOT_ESP32_C6: {
    es: "La placa detectada no es compatible.",
    en: "Detected board is not compatible.",
  },
  BENCH_FLASH_CONSENT_REQUIRED: {
    es: "Pulsá Instalar firmware para autorizar el borrado e instalación.",
    en: "Press Instalar firmware to authorize erase and install.",
  },
  BENCH_WEBSERIAL_REQUIRED: {
    es: "Web Serial no disponible (Chrome/Edge de escritorio por HTTPS).",
    en: "Web Serial unavailable (desktop Chrome/Edge over HTTPS).",
  },
  BENCH_HTTPS_REQUIRED: {
    es: "Se requiere HTTPS (o localhost) para acceder al puerto USB.",
    en: "HTTPS (or localhost) is required for USB port access.",
  },
});

export function describeC6ZigbeeBenchGateReason(reason, lang = "es") {
  const entry = C6_ZIGBEE_BENCH_GATE_MESSAGES[reason];
  if (!entry) return reason || "";
  return lang === "en" ? entry.en : entry.es;
}

function hasDestructiveFlashConsent(options = {}) {
  // Same pattern as stock C6 flasher: the Install CTA click is erase consent.
  return options.destructiveFlashConsent === true || options.eraseAcknowledged === true;
}

/**
 * Pre-flash gates (package, board, disconnect, CTA consent). Chip/4MB detection
 * runs after the user grants WebSerial — same as stock MicroPython flash.
 */
export function assertC6ZigbeeBenchFlashConsent(options = {}) {
  if (!options.validated?.ok) return { allowed: false, reason: "BENCH_PACKAGE_NOT_VERIFIED" };
  if (options.profileId !== C6_ZIGBEE_BENCH_PACKAGE.board) {
    return { allowed: false, reason: "BENCH_WRONG_BOARD_PROFILE" };
  }
  if (options.connected === true) return { allowed: false, reason: "BENCH_DISCONNECT_FIRST" };
  if (!hasDestructiveFlashConsent(options)) {
    return { allowed: false, reason: "BENCH_FLASH_CONSENT_REQUIRED" };
  }
  if (options.detection) {
    if (options.detection.ok !== true || options.detection.flashSize !== "4MB") {
      return { allowed: false, reason: "BENCH_DETECTION_REQUIRED" };
    }
    if (!isEsp32C6Chip(options.detection.chipName)) {
      return { allowed: false, reason: "BENCH_CHIP_NOT_ESP32_C6" };
    }
  }
  return { allowed: true, reason: "ok" };
}

/**
 * One-click install (static fetch/SHA → WebSerial detect+flash), matching stock C6 UX.
 * CTA click supplies destructiveFlashConsent. Fail-closed on fetch/SHA/USB/chip
 * gaps. No mandatory backup, file picker, Continuar, or second confirm UI.
 *
 * @param {{
 *   profileId: string,
 *   connected?: boolean,
 *   onLog?: Function,
 *   onProgress?: Function,
 *   fetchPackage?: Function,
 *   flash?: Function,
 *   getAccessToken?: Function,
 *   fetchImpl?: Function,
 *   digest?: Function,
 *   signal?: AbortSignal,
 * }} options
 */
export async function orchestrateC6ZigbeeBenchOneClick(options = {}) {
  const fetchPackage = options.fetchPackage || fetchAndValidateC6ZigbeeBenchPackage;
  const flash = options.flash || flashC6ZigbeeBenchPackage;
  const onProgress = options.onProgress || (() => {});

  if (options.profileId !== C6_ZIGBEE_BENCH_PACKAGE.board) {
    return { ok: false, stage: "fetch", reason: "BENCH_WRONG_BOARD_PROFILE", flashed: false };
  }
  if (options.connected === true) {
    return { ok: false, stage: "fetch", reason: "BENCH_DISCONNECT_FIRST", flashed: false };
  }

  onProgress({ stage: "fetch", pct: 10, phase: "fetch" });
  const validated = await fetchPackage({
    getAccessToken: options.getAccessToken,
    fetchImpl: options.fetchImpl,
    digest: options.digest,
    signal: options.signal,
    onProgress: (p) => onProgress({ stage: "fetch", pct: 10 + Math.round((p.pct || 0) * 0.5), phase: p.phase, role: p.role }),
  });
  if (!validated?.ok) {
    return {
      ok: false,
      stage: "fetch",
      reason: validated?.reason || "BENCH_FETCH_FAILED",
      detail: validated?.detail,
      validated,
      flashed: false,
    };
  }

  onProgress({ stage: "flash", pct: 65, phase: "flash" });
  try {
    const flashResult = await flash(validated, {
      profileId: options.profileId,
      connected: options.connected,
      detection: options.detection,
      destructiveFlashConsent: true,
      eraseAcknowledged: true,
      onLog: options.onLog,
      requestPort: options.requestPort,
      onProgress: (p) => onProgress({ stage: "flash", pct: 65 + Math.round((p.pct || 0) * 0.35), phase: "flash_write" }),
    });
    onProgress({ stage: "flash", pct: 100, phase: "done" });
    return {
      ok: true,
      stage: "done",
      validated,
      flashResult,
      flashed: true,
    };
  } catch (e) {
    return {
      ok: false,
      stage: "flash",
      reason: e?.message || String(e),
      validated,
      flashed: false,
    };
  }
}

/**
 * User-initiated physical write. Package validation + CTA consent precede
 * requestPort(); connected chip and 4 MB flash are verified in the bootloader.
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
