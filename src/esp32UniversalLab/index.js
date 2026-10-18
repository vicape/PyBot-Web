/**
 * ESP32 Universal Lab — isolated, profile-driven hardware extension.
 *
 * Additive seam: import from here. Do not rewrite legacy board handlers.
 * Wire into the IDE only behind isEsp32UniversalLabActive() and a
 * non-legacy board selection (future milestone).
 */

export {
  CAPABILITY_STATUS,
  isCapabilityUsable,
  isCapabilityExplicitlyUnavailable,
} from "./capabilityStatus.js";

export {
  ESP32_UNIVERSAL_LAB_DEFAULT_ENABLED,
  LAB_STORAGE_KEYS,
  LEGACY_BOARD_TYPES,
  isEsp32UniversalLabEnabled,
  isEsp32UniversalLabActive,
  getEsp32UniversalLabProfileId,
  shouldUseLegacyHardwarePath,
} from "./featureGate.js";

export {
  BOARD_PROFILE_IDS,
  BOARD_PROFILES,
  listBoardProfiles,
  getBoardProfile,
  isSupportedBoardProfile,
  getCapability,
  assertCapabilityAvailable,
} from "./profiles/index.js";

export {
  FIRMWARE_MANIFEST_VERSION,
  resolveFirmwareTarget,
  hasFlashableFirmwareImage,
} from "./firmwareManifest.js";

export {
  LAB_BOARD_TYPE_SENTINEL,
  Esp32UniversalLabNotActiveError,
  Esp32UniversalLabNotReadyError,
  resolveLabRuntimeContext,
  connectLabBoard,
  flashLabFirmware,
  executeLabProgram,
  stopLabProgram,
  recoverLabBoard,
} from "./runtime/adapter.js";

export {
  PYBOT_PYTHON_API_MODULES,
  listUsablePythonModules,
  describePythonModuleAvailability,
} from "./pythonApi/manifest.js";
