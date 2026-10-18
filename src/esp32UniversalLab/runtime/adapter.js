/**
 * Isolated connect / flash / execute / recover adapter for Universal Lab.
 * M1: C6 profile has a real MicroPython Web Serial path when firmware validates.
 * S3 profiles remain selectable but refuse connect/program (not ready).
 * Never falls through to legacy board handlers.
 */

import {
  isEsp32UniversalLabEnabled,
  isEsp32UniversalLabActive,
  getEsp32UniversalLabProfileId,
  shouldUseLegacyHardwarePath,
} from "../featureGate.js";
import { getBoardProfile } from "../profiles/index.js";
import {
  resolveFirmwareTarget,
  hasFlashableFirmwareImage,
  getFirmwareImageManifest,
} from "../firmwareManifest.js";
import { listC6ModulesForInstall } from "../pythonApi/boardModules.js";
import {
  clearLabSession,
  getLabSession,
  isLabSessionConnected,
  setLabSession,
} from "./labSession.js";
import {
  loadAndValidateC6Firmware,
  connectC6Bootloader,
  writeC6Firmware,
  resetC6AndRelease,
} from "./c6Flasher.js";
import { WAVESHARE_ESP32_C6_LCD_147_ID } from "../profiles/waveshareEsp32C6Lcd147.js";

/** Sentinel board type for lab-only callers (stored in pybot_board_type when lab selected). */
export const LAB_BOARD_TYPE_SENTINEL = "esp32-universal-lab";

export class Esp32UniversalLabNotActiveError extends Error {
  constructor(message = "ESP32 Universal Lab is not active") {
    super(message);
    this.name = "Esp32UniversalLabNotActiveError";
  }
}

export class Esp32UniversalLabNotReadyError extends Error {
  /**
   * @param {string} operation
   * @param {string} milestone
   * @param {string} [detail]
   */
  constructor(operation, milestone, detail) {
    const extra = detail ? ` ${detail}` : "";
    super(
      `ESP32 Universal Lab operation "${operation}" is not ready yet ` +
        `(planned ${milestone}). Isolated stack only — legacy handlers unchanged.${extra}`,
    );
    this.name = "Esp32UniversalLabNotReadyError";
    this.operation = operation;
    this.milestone = milestone;
  }
}

/**
 * @param {string|null|undefined} [boardType]
 * @returns {{
 *   active: boolean,
 *   enabled: boolean,
 *   profileId: string|null,
 *   profile: object|null,
 *   firmware: object|null,
 *   usesLegacyPath: boolean,
 *   runtimeReady: boolean,
 * }}
 */
export function resolveLabRuntimeContext(boardType = LAB_BOARD_TYPE_SENTINEL) {
  const enabled = isEsp32UniversalLabEnabled();
  const rawProfileId = getEsp32UniversalLabProfileId();
  const profile = getBoardProfile(rawProfileId);
  const profileOk = profile != null;
  const usesLegacyPath = shouldUseLegacyHardwarePath(boardType);
  const active =
    enabled &&
    isEsp32UniversalLabActive() &&
    profileOk &&
    !usesLegacyPath;

  return {
    active,
    enabled,
    profileId: profileOk ? rawProfileId : null,
    profile: profileOk ? profile : null,
    firmware: profileOk ? resolveFirmwareTarget(rawProfileId) : null,
    usesLegacyPath,
    runtimeReady: profileOk && profile.runtimeReady === true,
  };
}

function requireActiveLab(boardType) {
  const ctx = resolveLabRuntimeContext(boardType ?? LAB_BOARD_TYPE_SENTINEL);
  if (!ctx.active) {
    throw new Esp32UniversalLabNotActiveError(
      "Select a supported Universal Lab board profile and enable the feature gate first.",
    );
  }
  return ctx;
}

function requireRuntimeReady(ctx, operation) {
  if (!ctx.runtimeReady) {
    const milestone = ctx.profile?.firmware?.milestone ?? "M3";
    throw new Esp32UniversalLabNotReadyError(
      operation,
      milestone,
      "This board profile is marked not ready — connect/program are disabled.",
    );
  }
}

function requireWebSerial() {
  if (typeof navigator === "undefined" || !("serial" in navigator)) {
    throw new Error("PYBOT_LAB:MISSING_WEB_SERIAL");
  }
  if (
    typeof globalThis.isSecureContext === "boolean" &&
    !globalThis.isSecureContext
  ) {
    throw new Error("PYBOT_LAB:HTTPS_REQUIRED");
  }
}

async function requestLabPort() {
  requireWebSerial();
  try {
    return await navigator.serial.requestPort();
  } catch (e) {
    const name = e?.name ?? "";
    if (name === "NotFoundError") throw new Error("PYBOT_LAB:PORT_LIST_EMPTY");
    if (name === "SecurityError") throw new Error("PYBOT_LAB:PERMISSION");
    throw e;
  }
}

async function installC6Modules(session) {
  for (const [path, source] of listC6ModulesForInstall()) {
    await session.installFile(path, source);
  }
}

/**
 * @param {string|null|undefined} [boardType]
 * @param {{ requestPort?: () => Promise<any>, skipModuleInstall?: boolean }} [options]
 */
export async function connectLabBoard(boardType, options = {}) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "connect");

  await clearLabSession();

  const port =
    typeof options.requestPort === "function"
      ? await options.requestPort()
      : await requestLabPort();

  const { connectMicroPythonEsp32Session } = await import(
    "../../micropython/micropythonSession.js"
  );

  let session;
  let baudRate;
  try {
    ({ session, baudRate } = await connectMicroPythonEsp32Session(port, {
      recoverRepl: true,
      mode: LAB_BOARD_TYPE_SENTINEL,
    }));
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (msg === "NEEDS_PREP") {
      throw new Error(
        "PYBOT_LAB:NEEDS_FIRMWARE MicroPython not detected. Use Flash MicroPython (C6) first.",
      );
    }
    if (msg === "BUSY") {
      throw new Error("PYBOT_LAB:PORT_BUSY");
    }
    throw new Error(`PYBOT_LAB:CONNECT_FAIL:${msg}`);
  }

  if (options.skipModuleInstall !== true) {
    try {
      await installC6Modules(session);
    } catch (e) {
      try {
        await session.close();
      } catch {
        /* ignore */
      }
      throw new Error(
        `PYBOT_LAB:MODULE_INSTALL_FAIL:${e?.message ?? String(e)}`,
      );
    }
  }

  setLabSession({
    session,
    profileId: ctx.profileId,
    baudRate,
    port,
  });

  return {
    ok: true,
    mode: LAB_BOARD_TYPE_SENTINEL,
    profileId: ctx.profileId,
    baudRate,
    hardwareValidation: "UNVERIFIED",
    message:
      "Connected via Web Serial to Universal Lab C6 profile. Hardware I/O remains UNVERIFIED until bench tests.",
  };
}

/**
 * Validate image URL/sha/version then flash official MicroPython for C6.
 * @param {string|null|undefined} [boardType]
 * @param {{
 *   requestPort?: () => Promise<any>,
 *   onLog?: (line: string) => void,
 *   onProgress?: (info: object) => void,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export async function flashLabFirmware(boardType, options = {}) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "flash");

  if (ctx.profileId !== WAVESHARE_ESP32_C6_LCD_147_ID) {
    throw new Esp32UniversalLabNotReadyError(
      "flash",
      ctx.firmware?.milestone ?? "M3",
    );
  }
  if (!hasFlashableFirmwareImage(ctx.profileId)) {
    throw new Error(
      "PYBOT_LAB:FIRMWARE_NOT_OFFERED No validated firmware image for this profile.",
    );
  }

  const imageManifest = getFirmwareImageManifest(ctx.profileId);
  if (!imageManifest) {
    throw new Error("PYBOT_LAB:FIRMWARE_MANIFEST_MISSING");
  }

  // Validate bytes before opening the bootloader / offering a write.
  const { bytes, manifest, sha256 } = await loadAndValidateC6Firmware(
    imageManifest,
    { fetchImpl: options.fetchImpl },
  );

  await clearLabSession();

  const port =
    typeof options.requestPort === "function"
      ? await options.requestPort()
      : await requestLabPort();

  const boot = await connectC6Bootloader(port, { onLog: options.onLog });
  try {
    await writeC6Firmware(boot, bytes, {
      manifest,
      onProgress: options.onProgress,
    });
    await resetC6AndRelease(boot);
  } catch (e) {
    try {
      await resetC6AndRelease(boot);
    } catch {
      /* ignore */
    }
    throw e;
  }

  return {
    ok: true,
    profileId: ctx.profileId,
    version: manifest.version,
    sha256,
    imageId: manifest.board,
    hardwareValidation: "UNVERIFIED",
    message:
      "MicroPython ESP32_GENERIC_C6 flashed after SHA-256 validation. Physical verify pending.",
  };
}

/**
 * @param {string} code
 * @param {string|null|undefined} [boardType]
 * @param {{ onOut?: Function, onErr?: Function, shouldStop?: Function }} [cb]
 */
export async function executeLabProgram(code, boardType, cb = {}) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "execute");
  const session = getLabSession();
  if (!session) {
    throw new Error("PYBOT_LAB:NOT_CONNECTED");
  }
  try {
    await session.interruptAndRecoverRepl();
  } catch {
    /* ignore */
  }
  const prelude = [
    "# Universal Lab C6 prelude — import board helpers when present",
    "try:",
    "    import pybot.gpio as gpio",
    "except ImportError:",
    "    gpio = None",
    "try:",
    "    import pybot.display as display",
    "except ImportError:",
    "    display = None",
    "try:",
    "    import pybot.wifi as wifi",
    "except ImportError:",
    "    wifi = None",
    "try:",
    "    import pybot.bluetooth as bluetooth",
    "except ImportError:",
    "    bluetooth = None",
    "",
  ].join("\n");
  return session.runProgram(code, { ...cb, prelude });
}

/** @param {string|null|undefined} [boardType] */
export async function stopLabProgram(boardType) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "stop");
  const session = getLabSession();
  if (!session) {
    throw new Error("PYBOT_LAB:NOT_CONNECTED");
  }
  await session.interruptAndRecoverRepl();
  return { ok: true };
}

/**
 * Save user program as main.py for autonomous boot.
 * @param {string} code
 * @param {string|null|undefined} [boardType]
 */
export async function saveLabProgram(code, boardType) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "save");
  const session = getLabSession();
  if (!session) {
    throw new Error("PYBOT_LAB:NOT_CONNECTED");
  }
  await session.installFile("main.py", String(code ?? ""));
  return { ok: true, path: "main.py", hardwareValidation: "UNVERIFIED" };
}

/** @param {string|null|undefined} [boardType] */
export async function recoverLabBoard(boardType) {
  const ctx = requireActiveLab(boardType);
  requireRuntimeReady(ctx, "recover");
  const session = getLabSession();
  if (!session) {
    // Soft recovery without an open session: require user reconnect.
    throw new Error(
      "PYBOT_LAB:RECOVER_NEEDS_CONNECT Connect the board first, then recover REPL.",
    );
  }
  await session.interruptAndRecoverRepl();
  return { ok: true, hardwareValidation: "UNVERIFIED" };
}

/** @param {string|null|undefined} [boardType] */
export async function disconnectLabBoard(boardType) {
  if (boardType != null) {
    // Optional: still clear even if inactive so UI can recover.
    try {
      requireActiveLab(boardType);
    } catch {
      /* clear anyway */
    }
  }
  await clearLabSession();
  return { ok: true };
}

export { isLabSessionConnected, getLabSession };
