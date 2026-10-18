/**
 * Feature gate for ESP32 Universal Lab (Waveshare commercial board profiles).
 *
 * Isolation contract:
 * - Default OFF. Legacy Arduino / ESP32 MicroPython / EDA6 paths stay untouched.
 * - Lab stack activates only when the gate is enabled AND a supported profile id
 *   is selected via the dedicated storage key (not pybot_board_type).
 * - No automatic activation from chip-id alone (peripheral identity requires
 *   explicit commercial board confirmation).
 *
 * Storage keys (lab-only; never rewrite legacy board type):
 *   localStorage.pybot_esp32_lab_enabled  "1"|"true" enables gate
 *   localStorage.pybot_esp32_lab_profile   profile id string
 *
 * Session overrides (tests):
 *   globalThis.__PYBOT_ESP32_LAB_ENABLED__
 *   globalThis.__PYBOT_ESP32_LAB_PROFILE__
 */

export const ESP32_UNIVERSAL_LAB_DEFAULT_ENABLED = false;

export const LAB_STORAGE_KEYS = Object.freeze({
  enabled: "pybot_esp32_lab_enabled",
  profile: "pybot_esp32_lab_profile",
});

/**
 * @returns {boolean}
 */
export function isEsp32UniversalLabEnabled() {
  try {
    const g = globalThis.__PYBOT_ESP32_LAB_ENABLED__;
    if (g === true || g === false) return g;
  } catch {
    /* ignore */
  }
  try {
    const ls = globalThis.localStorage?.getItem(LAB_STORAGE_KEYS.enabled);
    if (ls === "0" || ls === "false") return false;
    if (ls === "1" || ls === "true") return true;
  } catch {
    /* ignore */
  }
  return ESP32_UNIVERSAL_LAB_DEFAULT_ENABLED === true;
}

/**
 * Raw profile id from session/localStorage (may be invalid).
 * @returns {string|null}
 */
export function getEsp32UniversalLabProfileId() {
  try {
    const g = globalThis.__PYBOT_ESP32_LAB_PROFILE__;
    if (typeof g === "string" && g.trim()) return g.trim();
  } catch {
    /* ignore */
  }
  try {
    const ls = globalThis.localStorage?.getItem(LAB_STORAGE_KEYS.profile);
    if (typeof ls === "string" && ls.trim()) return ls.trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Lab is active only when enabled AND a non-empty profile id is set.
 * Callers must still validate the id against the profile registry.
 * @returns {boolean}
 */
export function isEsp32UniversalLabActive() {
  if (!isEsp32UniversalLabEnabled()) return false;
  return getEsp32UniversalLabProfileId() != null;
}

/**
 * Legacy IDE board types that must never be remapped by the lab gate.
 */
export const LEGACY_BOARD_TYPES = Object.freeze([
  "arduino-firmata",
  "esp32-micropython",
  "esp32-eda6",
  "esp32-serial",
]);

/**
 * @param {string|null|undefined} boardType  value from getBoardType() / pybot_board_type
 * @returns {boolean} true when lab must NOT intercept (legacy path)
 */
export function shouldUseLegacyHardwarePath(boardType) {
  if (!isEsp32UniversalLabActive()) return true;
  if (boardType == null || boardType === "") return true;
  return LEGACY_BOARD_TYPES.includes(boardType);
}
