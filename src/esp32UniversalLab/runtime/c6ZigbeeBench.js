/**
 * TARGET: vicape/PyBot-Web (branch feature/esp32-universal-lab only).
 * Exact, private firmware-build acceptance for the first physical ESP32-C6 bench.
 * Guided "Preparar e instalar" flow: detect C6+4MB, obtain+verify pinned package
 * via authenticated server distributor, full 4 MB backup to a user-saved file,
 * explicit consent, then manual flash. Binaries stay outside Git and production.
 * Full-image backup preserves on-device VFS paths /main.py, /boot.py, /pybot/assets.
 */
import { isEsp32C6Chip } from "../firmware/esp32GenericC6.js";
import { WAVESHARE_ESP32_C6_LCD_147_ID } from "../profiles/waveshareEsp32C6Lcd147.js";
import { getSupabase } from "../../supabaseClient.js";
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
export const C6_ZIGBEE_BENCH_FETCH_ACTION = "Obtener firmware y verificar";
export const C6_ZIGBEE_BENCH_FIRMWARE_API = "/api/c6-zigbee-bench-firmware";

/**
 * Exact one-time operator setup when Preview secrets / durable private storage
 * are missing. Not an end-user step; surfaced only as operator_setup_required.
 */
export const C6_ZIGBEE_BENCH_OPERATOR_SETUP =
  "OPERATOR_SETUP (Vercel Preview feature/esp32-universal-lab only): upload Maxwell artifact 12161052985 zigbee-firmware-private-bench/*.bin to private object storage that outlives GitHub Actions retention; set SUPABASE_URL, SUPABASE_SERVICE_KEY, PYBOT_C6_FIRMWARE_OPERATOR_EMAILS, PYBOT_C6_FIRMWARE_SIGNING_SECRET, PYBOT_C6_FIRMWARE_STORAGE_BASE_URL, and PYBOT_C6_FIRMWARE_STORAGE_AUTH_HEADER (Bearer/token for that store). Optional interim: PYBOT_C6_FIRMWARE_GITHUB_TOKEN + PYBOT_C6_FIRMWARE_GHA_ARTIFACT_ID=12161052985 + PYBOT_C6_FIRMWARE_GHA_REPO=vicape/cursor-control (still migrate to durable storage before artifact expiry).";

export const C6_ZIGBEE_BENCH_PACKAGE = Object.freeze({
  version: "0.1.0",
  board: WAVESHARE_ESP32_C6_LCD_147_ID,
  chip: "ESP32-C6",
  hardwareValidation: "UNVERIFIED",
  sourceCommit: "834a2ecd0ee648b3570d8c913f358d262b2a92ae",
  /** Provenance pointer only — never used as a browser fetch URL. */
  sourceArtifact: "https://github.com/vicape/cursor-control/actions/runs/39193349317/artifacts/12161052985",
  pinnedRunId: "39193349317",
  pinnedArtifactId: "12161052985",
  autoFlash: false,
  publicReady: false,
  noticesPath: "firmware/pybot-c6-micropython-zigbee/THIRD_PARTY_NOTICES.md",
  durableManifestPath: "firmware/pybot-c6-micropython-zigbee/private-bench-manifest.json",
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
 * Automatic delivery via authenticated server distributor + short-lived tickets.
 * License: esp-zboss-lib permits binary redistribution with notice retention;
 * delivery is restricted to authenticated private physical bench.
 */
export const C6_ZIGBEE_BENCH_DISTRIBUTION = Object.freeze({
  status: "AUTOMATIC_SERVER",
  automaticFetchSupported: true,
  authorizedEndpointSupported: true,
  endpointPath: C6_ZIGBEE_BENCH_FIRMWARE_API,
  fetchActionLabel: C6_ZIGBEE_BENCH_FETCH_ACTION,
  pinnedRunId: C6_ZIGBEE_BENCH_PACKAGE.pinnedRunId,
  pinnedArtifactId: C6_ZIGBEE_BENCH_PACKAGE.pinnedArtifactId,
  operatorSetup: C6_ZIGBEE_BENCH_OPERATOR_SETUP,
  licensePolicy:
    "Authenticated private bench only. THIRD_PARTY_NOTICES include esp-zboss-lib conditions (retain copyright/disclaimer; no reverse-engineering).",
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
 * Resolver for package acquisition UI. Automatic authenticated path is the product
 * flow; ordinary users see obtain/verify status, never an operator-decision popup.
 */
export function resolveC6ZigbeeBenchPackageFetch() {
  return {
    status: C6_ZIGBEE_BENCH_DISTRIBUTION.status,
    automaticFetchSupported: true,
    authorizedEndpointSupported: true,
    endpointPath: C6_ZIGBEE_BENCH_DISTRIBUTION.endpointPath,
    fetchActionLabel: C6_ZIGBEE_BENCH_FETCH_ACTION,
    operatorSetup: C6_ZIGBEE_BENCH_OPERATOR_SETUP,
    pinnedRunId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedRunId,
    pinnedArtifactId: C6_ZIGBEE_BENCH_DISTRIBUTION.pinnedArtifactId,
    licensePolicy: C6_ZIGBEE_BENCH_DISTRIBUTION.licensePolicy,
  };
}

async function defaultAccessToken() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token ?? null;
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
 * Authenticated server fetch of the three verified segments + client SHA check.
 * End users never download GitHub ZIPs or pick .bin files.
 * @param {{getAccessToken?:Function, fetchImpl?:Function, onProgress?:Function, signal?:AbortSignal}} options
 */
export async function fetchAndValidateC6ZigbeeBenchPackage(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "BENCH_FETCH_UNAVAILABLE" };
  }
  const token =
    typeof options.getAccessToken === "function"
      ? await options.getAccessToken()
      : await defaultAccessToken();
  if (!token) {
    return { ok: false, reason: "BENCH_AUTH_DENIED", detail: "missing_bearer_token" };
  }
  options.onProgress?.({ phase: "mint", pct: 5 });
  let mintRes;
  try {
    mintRes = await fetchImpl(C6_ZIGBEE_BENCH_FIRMWARE_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: options.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, reason: "BENCH_FETCH_INTERRUPTED" };
    return { ok: false, reason: "BENCH_FETCH_NETWORK", detail: String(e?.message || e) };
  }
  let mintJson = null;
  try {
    mintJson = await mintRes.json();
  } catch {
    mintJson = null;
  }
  if (mintRes.status === 401 || mintRes.status === 403) {
    return {
      ok: false,
      reason: "BENCH_AUTH_DENIED",
      detail: mintJson?.reason || "unauthorized",
    };
  }
  if (mintRes.status === 503 || mintJson?.error === "operator_setup_required") {
    return {
      ok: false,
      reason: "BENCH_OPERATOR_SETUP_REQUIRED",
      detail: mintJson?.reason || C6_ZIGBEE_BENCH_OPERATOR_SETUP,
    };
  }
  if (!mintRes.ok || !mintJson?.ok || !Array.isArray(mintJson.tickets)) {
    return {
      ok: false,
      reason: mintJson?.error === "hash_mismatch" ? "BENCH_SERVER_HASH_MISMATCH" : "BENCH_FETCH_FAILED",
      detail: mintJson?.reason || `http_${mintRes.status}`,
    };
  }
  const files = [];
  const total = mintJson.tickets.length;
  for (let i = 0; i < total; i++) {
    const ticket = mintJson.tickets[i];
    options.onProgress?.({
      phase: "download",
      role: ticket.role,
      pct: 10 + Math.round(((i + 0.5) / total) * 70),
    });
    let segRes;
    try {
      segRes = await fetchImpl(ticket.path || `${C6_ZIGBEE_BENCH_FIRMWARE_API}?ticket=${encodeURIComponent(ticket.ticket)}`, {
        method: "GET",
        signal: options.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, reason: "BENCH_FETCH_INTERRUPTED" };
      return { ok: false, reason: "BENCH_FETCH_NETWORK", detail: String(e?.message || e) };
    }
    if (!segRes.ok) {
      let errBody = null;
      try {
        errBody = await segRes.json();
      } catch {
        errBody = null;
      }
      if (errBody?.error === "hash_mismatch") {
        return { ok: false, reason: "BENCH_SERVER_HASH_MISMATCH", detail: errBody.reason };
      }
      return { ok: false, reason: "BENCH_SEGMENT_FETCH_FAILED", detail: ticket.role };
    }
    const buf = await segRes.arrayBuffer();
    files.push({
      name: ticket.name,
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
    source: "authenticated-server",
    packageVersion: mintJson.packageVersion || C6_ZIGBEE_BENCH_PACKAGE.version,
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

/** Human-readable gate codes for the compact installer UI (never invent success). */
export const C6_ZIGBEE_BENCH_GATE_MESSAGES = Object.freeze({
  BENCH_PACKAGE_NOT_VERIFIED: {
    es: "Obtené y verificá el firmware automáticamente primero.",
    en: "Obtain and verify the firmware automatically first.",
  },
  BENCH_AUTH_DENIED: {
    es: "Sesión requerida: iniciá sesión con una cuenta de operador autorizada.",
    en: "Sign in with an authorized operator account.",
  },
  BENCH_OPERATOR_SETUP_REQUIRED: {
    es: "Falta configuración one-time del operador (almacenamiento privado + secretos Preview).",
    en: "One-time operator setup missing (private storage + Preview secrets).",
  },
  BENCH_FETCH_INTERRUPTED: {
    es: "Descarga interrumpida. Reintentá Obtener firmware y verificar.",
    en: "Download interrupted. Retry Obtener firmware y verificar.",
  },
  BENCH_SERVER_HASH_MISMATCH: {
    es: "El paquete del servidor no coincide con el manifesto anclado (SHA).",
    en: "Server package does not match the pinned manifest (SHA).",
  },
  BENCH_WRONG_BOARD_PROFILE: {
    es: "Seleccioná Waveshare ESP32-C6-LCD-1.47 en Placa.",
    en: "Select Waveshare ESP32-C6-LCD-1.47 in Board.",
  },
  BENCH_DISCONNECT_FIRST: {
    es: "Desconectá la placa del IDE antes de grabar.",
    en: "Disconnect the board from the IDE before flashing.",
  },
  BENCH_DETECTION_REQUIRED: {
    es: "Detectá ESP32-C6 con flash 4 MB primero.",
    en: "Detect ESP32-C6 with 4 MB flash first.",
  },
  BENCH_CHIP_NOT_ESP32_C6: {
    es: "El chip detectado no es ESP32-C6.",
    en: "Detected chip is not ESP32-C6.",
  },
  BENCH_BACKUP_REQUIRED: {
    es: "Respaldo completo de 4 MB obligatorio antes de borrar.",
    en: "Full 4 MB backup required before erase.",
  },
  BENCH_BACKUP_DOWNLOAD_ACK_REQUIRED: {
    es: "Confirmá que el archivo de respaldo quedó guardado.",
    en: "Acknowledge that the backup file was saved.",
  },
  BENCH_ERASE_ACK_REQUIRED: {
    es: "Marcá que entendés el borrado total de la flash.",
    en: "Acknowledge full flash erase.",
  },
  BENCH_SECOND_CONFIRMATION_REQUIRED: {
    es: "Escribí ESP32-C6 para confirmar.",
    en: "Type ESP32-C6 to confirm.",
  },
});

export function describeC6ZigbeeBenchGateReason(reason, lang = "es") {
  const entry = C6_ZIGBEE_BENCH_GATE_MESSAGES[reason];
  if (!entry) return reason || "";
  return lang === "en" ? entry.en : entry.es;
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
