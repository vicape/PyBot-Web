import {
  WAVESHARE_ESP32_C6_LCD_147_ID,
  waveshareEsp32C6Lcd147,
} from "./waveshareEsp32C6Lcd147.js";
import {
  WAVESHARE_ESP32_S3_TOUCH_LCD_154_ID,
  waveshareEsp32S3TouchLcd154,
} from "./waveshareEsp32S3TouchLcd154.js";
import {
  WAVESHARE_ESP32_S3_TOUCH_LCD_7_ID,
  waveshareEsp32S3TouchLcd7,
} from "./waveshareEsp32S3TouchLcd7.js";
import {
  CAPABILITY_STATUS,
  isCapabilityUsable,
} from "../capabilityStatus.js";

export const BOARD_PROFILE_IDS = Object.freeze({
  WAVESHARE_ESP32_C6_LCD_147: WAVESHARE_ESP32_C6_LCD_147_ID,
  WAVESHARE_ESP32_S3_TOUCH_LCD_154: WAVESHARE_ESP32_S3_TOUCH_LCD_154_ID,
  WAVESHARE_ESP32_S3_TOUCH_LCD_7: WAVESHARE_ESP32_S3_TOUCH_LCD_7_ID,
});

/** @type {Readonly<Record<string, Readonly<object>>>} */
export const BOARD_PROFILES = Object.freeze({
  [WAVESHARE_ESP32_C6_LCD_147_ID]: waveshareEsp32C6Lcd147,
  [WAVESHARE_ESP32_S3_TOUCH_LCD_154_ID]: waveshareEsp32S3TouchLcd154,
  [WAVESHARE_ESP32_S3_TOUCH_LCD_7_ID]: waveshareEsp32S3TouchLcd7,
});

/**
 * @returns {readonly object[]}
 */
export function listBoardProfiles() {
  return Object.freeze(Object.values(BOARD_PROFILES));
}

/**
 * @param {string|null|undefined} profileId
 * @returns {object|null}
 */
export function getBoardProfile(profileId) {
  if (typeof profileId !== "string" || !profileId) return null;
  return BOARD_PROFILES[profileId] ?? null;
}

/**
 * @param {string|null|undefined} profileId
 * @returns {boolean}
 */
export function isSupportedBoardProfile(profileId) {
  return getBoardProfile(profileId) != null;
}

/**
 * @param {string} profileId
 * @param {string} capabilityName
 * @returns {{ status: string, usable: boolean, note: string|null, profileId: string }}
 */
export function getCapability(profileId, capabilityName) {
  const profile = getBoardProfile(profileId);
  if (!profile) {
    return {
      status: CAPABILITY_STATUS.UNSUPPORTED,
      usable: false,
      note: `Unknown board profile: ${profileId}`,
      profileId: String(profileId ?? ""),
    };
  }
  const status =
    profile.capabilities?.[capabilityName] ?? CAPABILITY_STATUS.UNSUPPORTED;
  const note = profile.capabilityNotes?.[capabilityName] ?? null;
  return {
    status,
    usable: isCapabilityUsable(status),
    note,
    profileId: profile.id,
  };
}

/**
 * Throws a clear, beginner-friendly English error for unavailable capabilities.
 * @param {string} profileId
 * @param {string} capabilityName
 */
export function assertCapabilityAvailable(profileId, capabilityName) {
  const info = getCapability(profileId, capabilityName);
  if (info.usable) return info;
  const note = info.note ? ` ${info.note}` : "";
  throw new Error(
    `Capability "${capabilityName}" is not available on profile "${profileId}" ` +
      `(status=${info.status}).${note}`,
  );
}
