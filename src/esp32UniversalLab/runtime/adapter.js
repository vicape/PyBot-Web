/**
 * Isolated connect / flash / execute / recover adapter for Universal Lab.
 * M0 delivers the seam only — operations refuse until later milestones ship
 * real firmware + transport. Never falls through to legacy board handlers.
 */

import {
  isEsp32UniversalLabEnabled,
  isEsp32UniversalLabActive,
  getEsp32UniversalLabProfileId,
  shouldUseLegacyHardwarePath,
} from "../featureGate.js";
import { isSupportedBoardProfile } from "../profiles/index.js";
import { resolveFirmwareTarget } from "../firmwareManifest.js";
import { CAPABILITY_STATUS } from "../capabilityStatus.js";

/** Sentinel board type for lab-only callers (not stored in pybot_board_type). */
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
   */
  constructor(operation, milestone) {
    super(
      `ESP32 Universal Lab operation "${operation}" is not ready yet ` +
        `(planned ${milestone}). Isolated stack only — legacy handlers unchanged.`,
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
 *   firmware: object|null,
 *   usesLegacyPath: boolean,
 * }}
 */
export function resolveLabRuntimeContext(boardType = LAB_BOARD_TYPE_SENTINEL) {
  const enabled = isEsp32UniversalLabEnabled();
  const rawProfileId = getEsp32UniversalLabProfileId();
  const profileOk = isSupportedBoardProfile(rawProfileId);
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
    firmware: profileOk ? resolveFirmwareTarget(rawProfileId) : null,
    usesLegacyPath,
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

/** @param {string|null|undefined} [boardType] */
export async function connectLabBoard(boardType) {
  requireActiveLab(boardType);
  throw new Esp32UniversalLabNotReadyError("connect", "M1");
}

/** @param {string|null|undefined} [boardType] */
export async function flashLabFirmware(boardType) {
  const ctx = requireActiveLab(boardType);
  if (ctx.firmware?.status !== CAPABILITY_STATUS.IMPLEMENTED) {
    throw new Esp32UniversalLabNotReadyError(
      "flash",
      ctx.firmware?.milestone ?? "M1",
    );
  }
  throw new Esp32UniversalLabNotReadyError("flash", "M1");
}

/** @param {string|null|undefined} [boardType] */
export async function executeLabProgram(boardType) {
  requireActiveLab(boardType);
  throw new Esp32UniversalLabNotReadyError("execute", "M1");
}

/** @param {string|null|undefined} [boardType] */
export async function stopLabProgram(boardType) {
  requireActiveLab(boardType);
  throw new Esp32UniversalLabNotReadyError("stop", "M1");
}

/** @param {string|null|undefined} [boardType] */
export async function recoverLabBoard(boardType) {
  requireActiveLab(boardType);
  throw new Esp32UniversalLabNotReadyError("recover", "M1");
}
