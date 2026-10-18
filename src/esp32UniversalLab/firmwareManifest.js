/**
 * Firmware / partition targeting for Universal Lab profiles.
 * M1: C6 registers the official MicroPython ESP32_GENERIC_C6 image (SHA validated before flash).
 */

import { getBoardProfile } from "./profiles/index.js";
import { CAPABILITY_STATUS } from "./capabilityStatus.js";
import { ESP32_GENERIC_C6_FIRMWARE } from "./firmware/esp32GenericC6.js";
import { WAVESHARE_ESP32_C6_LCD_147_ID } from "./profiles/waveshareEsp32C6Lcd147.js";

export const FIRMWARE_MANIFEST_VERSION = 1;

/** @type {Readonly<Record<string, typeof ESP32_GENERIC_C6_FIRMWARE>>} */
const IMAGE_BY_PROFILE = Object.freeze({
  [WAVESHARE_ESP32_C6_LCD_147_ID]: ESP32_GENERIC_C6_FIRMWARE,
});

/**
 * @param {string} profileId
 * @returns {typeof ESP32_GENERIC_C6_FIRMWARE | null}
 */
export function getFirmwareImageManifest(profileId) {
  return IMAGE_BY_PROFILE[profileId] ?? null;
}

/**
 * @param {string} profileId
 * @returns {{
 *   manifestVersion: number,
 *   profileId: string,
 *   chipFamily: string|null,
 *   target: string|null,
 *   imageId: string|null,
 *   imageSha256: string|null,
 *   imageUrl: string|null,
 *   version: string|null,
 *   partitionScheme: string|null,
 *   status: string,
 *   milestone: string|null,
 *   hardwareValidation: string,
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
      imageUrl: null,
      version: null,
      partitionScheme: null,
      status: CAPABILITY_STATUS.UNSUPPORTED,
      milestone: null,
      hardwareValidation: "UNVERIFIED",
    };
  }
  const fw = profile.firmware ?? {};
  const image = getFirmwareImageManifest(profile.id);
  return {
    manifestVersion: FIRMWARE_MANIFEST_VERSION,
    profileId: profile.id,
    chipFamily: profile.chipFamily ?? null,
    target: fw.target ?? null,
    imageId: image?.board ?? fw.imageId ?? null,
    imageSha256: image?.sha256 ?? fw.imageSha256 ?? null,
    imageUrl: image?.url ?? null,
    version: image?.version ?? fw.version ?? null,
    partitionScheme: fw.partitionScheme ?? null,
    status: fw.status ?? CAPABILITY_STATUS.PLANNED,
    milestone: fw.milestone ?? null,
    hardwareValidation: fw.hardwareValidation ?? "UNVERIFIED",
  };
}

/**
 * True when a flashable image is registered with url + sha + version.
 * Callers must still run loadAndValidateC6Firmware before writing.
 * @param {string} profileId
 */
export function hasFlashableFirmwareImage(profileId) {
  const t = resolveFirmwareTarget(profileId);
  return (
    t.status === CAPABILITY_STATUS.IMPLEMENTED &&
    typeof t.imageId === "string" &&
    typeof t.imageSha256 === "string" &&
    typeof t.imageUrl === "string" &&
    typeof t.version === "string"
  );
}

/**
 * Source-level check that a profile may offer flash in the UI.
 * Does not claim physical flash success.
 * @param {string} profileId
 */
export function canOfferFirmwareFlash(profileId) {
  if (!hasFlashableFirmwareImage(profileId)) return false;
  const profile = getBoardProfile(profileId);
  return profile?.runtimeReady === true;
}
