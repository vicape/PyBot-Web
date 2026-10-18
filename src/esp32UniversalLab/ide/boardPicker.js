/**
 * IDE board-picker helpers for Universal Lab (additive UI seam).
 * Legacy option values/labels stay unchanged; commercial models are separate.
 */

import {
  LAB_STORAGE_KEYS,
  isEsp32UniversalLabEnabled,
  getEsp32UniversalLabProfileId,
} from "../featureGate.js";
import {
  BOARD_PROFILE_IDS,
  getBoardProfile,
  listBoardProfiles,
} from "../profiles/index.js";
import { LAB_BOARD_TYPE_SENTINEL } from "../runtime/adapter.js";

/** Exact commercial labels required by the product contract (AC2). */
export const LAB_BOARD_PICKER_LABELS = Object.freeze({
  [BOARD_PROFILE_IDS.WAVESHARE_ESP32_C6_LCD_147]:
    "Waveshare ESP32-C6-LCD-1.47",
  [BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_154]:
    "ESP32-S3-Touch-LCD-1.54",
  [BOARD_PROFILE_IDS.WAVESHARE_ESP32_S3_TOUCH_LCD_7]:
    "ESP32-S3-Touch-LCD-7",
});

export const LAB_BOARD_GROUP_LABEL = "Waveshare ESP32 Universal Lab";

export const LEGACY_BOARD_PICKER_VALUES = Object.freeze([
  "arduino-firmata",
  "esp32-micropython",
  "esp32-eda6",
]);

/**
 * @param {string} profileId
 * @returns {string}
 */
export function labPickerOptionValue(profileId) {
  return `${LAB_BOARD_TYPE_SENTINEL}:${profileId}`;
}

/**
 * @param {string} value
 * @returns {{ kind: "legacy", boardType: string } | { kind: "lab", profileId: string } | null}
 */
export function parseBoardPickerValue(value) {
  const v = String(value ?? "");
  if (LEGACY_BOARD_PICKER_VALUES.includes(v)) {
    return { kind: "legacy", boardType: v };
  }
  const prefix = `${LAB_BOARD_TYPE_SENTINEL}:`;
  if (v.startsWith(prefix)) {
    const profileId = v.slice(prefix.length);
    if (getBoardProfile(profileId)) {
      return { kind: "lab", profileId };
    }
  }
  return null;
}

/**
 * @returns {readonly {
 *   profileId: string,
 *   value: string,
 *   label: string,
 *   displayLabel: string,
 *   runtimeReady: boolean,
 *   notReady: boolean,
 * }}
 */
export function listLabBoardPickerOptions() {
  return Object.freeze(
    listBoardProfiles().map((profile) => {
      const label =
        LAB_BOARD_PICKER_LABELS[profile.id] ?? profile.commercialName;
      const runtimeReady = profile.runtimeReady === true;
      return Object.freeze({
        profileId: profile.id,
        value: labPickerOptionValue(profile.id),
        label,
        displayLabel: runtimeReady ? label : `${label} — not ready`,
        runtimeReady,
        notReady: !runtimeReady,
      });
    }),
  );
}

/**
 * Persist lab selection (dedicated keys + sentinel board type).
 * @param {string} profileId
 */
export function applyLabBoardSelection(profileId) {
  const profile = getBoardProfile(profileId);
  if (!profile) {
    throw new Error(`Unknown Universal Lab board profile: ${profileId}`);
  }
  try {
    globalThis.localStorage?.setItem(LAB_STORAGE_KEYS.enabled, "1");
    globalThis.localStorage?.setItem(LAB_STORAGE_KEYS.profile, profileId);
    globalThis.localStorage?.setItem(
      "pybot_board_type",
      LAB_BOARD_TYPE_SENTINEL,
    );
  } catch {
    /* ignore storage failures in tests */
  }
  try {
    globalThis.__PYBOT_ESP32_LAB_ENABLED__ = true;
    globalThis.__PYBOT_ESP32_LAB_PROFILE__ = profileId;
  } catch {
    /* ignore */
  }
  return {
    boardType: LAB_BOARD_TYPE_SENTINEL,
    profileId,
    runtimeReady: profile.runtimeReady === true,
  };
}

/**
 * Clear lab gate when returning to a legacy board option.
 * Does not rewrite legacy labels or handlers.
 */
export function clearLabBoardSelection() {
  try {
    globalThis.localStorage?.removeItem(LAB_STORAGE_KEYS.enabled);
    globalThis.localStorage?.removeItem(LAB_STORAGE_KEYS.profile);
  } catch {
    /* ignore */
  }
  try {
    delete globalThis.__PYBOT_ESP32_LAB_ENABLED__;
    delete globalThis.__PYBOT_ESP32_LAB_PROFILE__;
  } catch {
    /* ignore */
  }
}

/**
 * Select value for the IDE <select> given current board + lab profile.
 * @param {string} boardType
 * @param {string|null|undefined} [profileId]
 */
export function resolveBoardPickerSelectValue(boardType, profileId) {
  if (boardType === LAB_BOARD_TYPE_SENTINEL) {
    const id = profileId || getEsp32UniversalLabProfileId();
    if (id && getBoardProfile(id)) return labPickerOptionValue(id);
  }
  if (LEGACY_BOARD_PICKER_VALUES.includes(boardType)) return boardType;
  return "arduino-firmata";
}

/**
 * @param {string|null|undefined} profileId
 * @returns {boolean}
 */
export function isLabProfileRuntimeReady(profileId) {
  const profile = getBoardProfile(profileId);
  return profile?.runtimeReady === true;
}

/**
 * @returns {{ active: boolean, profileId: string|null, runtimeReady: boolean }}
 */
export function getLabPickerState() {
  const profileId = getEsp32UniversalLabProfileId();
  const enabled = isEsp32UniversalLabEnabled();
  const profile = getBoardProfile(profileId);
  return {
    active: enabled && profile != null,
    profileId: profile ? profileId : null,
    runtimeReady: profile?.runtimeReady === true,
  };
}
