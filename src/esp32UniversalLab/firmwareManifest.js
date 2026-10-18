/**
 * Firmware / partition targeting for Universal Lab profiles.
 * M0: versioning schema only — no binary images yet (M1+).
 */

import { getBoardProfile } from "./profiles/index.js";
import { CAPABILITY_STATUS } from "./capabilityStatus.js";

export const FIRMWARE_MANIFEST_VERSION = 1;

/**
 * @param {string} profileId
 * @returns {{
 *   manifestVersion: number,
 *   profileId: string,
 *   chipFamily: string|null,
 *   target: string|null,
 *   imageId: string|null,
 *   imageSha256: string|null,
 *   partitionScheme: string|null,
 *   status: string,
 *   milestone: string|null,
 * }}
 */
export function resolveFirmwareTarget(profileId) {
  const profile = getBoardProfile(profileId);
  if (!profile) {
    return {
      manifestVersion: FIRMWARE_MANIFEST_VERSION,
      profileId: String(profileId ?? ""),
      chipFamily: null,
      target: null,
      imageId: null,
      imageSha256: null,
      partitionScheme: null,
      status: CAPABILITY_STATUS.UNSUPPORTED,
      milestone: null,
    };
  }
  const fw = profile.firmware ?? {};
  return {
    manifestVersion: FIRMWARE_MANIFEST_VERSION,
    profileId: profile.id,
    chipFamily: profile.chipFamily ?? null,
    target: fw.target ?? null,
    imageId: fw.imageId ?? null,
    imageSha256: fw.imageSha256 ?? null,
    partitionScheme: fw.partitionScheme ?? null,
    status: fw.status ?? CAPABILITY_STATUS.PLANNED,
    milestone: fw.milestone ?? null,
  };
}

/**
 * True when a flashable image is registered for this profile.
 * @param {string} profileId
 */
export function hasFlashableFirmwareImage(profileId) {
  const t = resolveFirmwareTarget(profileId);
  return (
    t.status === CAPABILITY_STATUS.IMPLEMENTED &&
    typeof t.imageId === "string" &&
    typeof t.imageSha256 === "string"
  );
}
