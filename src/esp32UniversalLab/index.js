/**
 * ESP32 Universal Lab — isolated, profile-driven hardware extension.
 *
 * Additive seam: import from here. Do not rewrite legacy board handlers.
 * Wire into the IDE only behind isEsp32UniversalLabActive() and a
 * non-legacy board selection (M1: PyBotIDE board picker + lab runtime).
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
  getFirmwareImageManifest,
  canOfferFirmwareFlash,
} from "./firmwareManifest.js";

export { ESP32_GENERIC_C6_FIRMWARE, isEsp32C6Chip } from "./firmware/esp32GenericC6.js";

export {
  LAB_BOARD_TYPE_SENTINEL,
  Esp32UniversalLabNotActiveError,
  Esp32UniversalLabNotReadyError,
  resolveLabRuntimeContext,
  connectLabBoard,
  flashLabFirmware,
  executeLabProgram,
  stopLabProgram,
  saveLabProgram,
  recoverLabBoard,
  disconnectLabBoard,
  isLabSessionConnected,
  getLabSession,
  ensureC6PybotInstallRoot,
  installC6LabModules,
  C6_SAFE_RECOVERY_HINT,
  C6_MODULE_ROOT,
} from "./runtime/adapter.js";

export {
  PYBOT_PYTHON_API_MODULES,
  listUsablePythonModules,
  describePythonModuleAvailability,
} from "./pythonApi/manifest.js";

export { listC6ModulesForInstall, C6_BOARD_MODULES } from "./pythonApi/boardModules.js";

export {
  PBI_MAGIC,
  MAX_ASSET_EDGE,
  MAX_ASSET_BYTES,
  MAX_FULLSCREEN_WIDTH,
  MAX_FULLSCREEN_HEIGHT,
  MAX_FULLSCREEN_BYTES,
  rgbTo565,
  encodePbi,
  decodePbi,
  checksumSum32,
  detectImageMime,
  assetStemFromName,
  convertImageFileToPbi,
} from "./graphics/index.js";

export {
  C6_ASSET_DIR,
  C6_ASSET_MANIFEST,
  ensureC6AssetDir,
  probeC6FilesystemSpace,
  transferC6BinaryAsset,
  uploadC6ImageAsset,
  cleanupOwnedTemp,
  bytesToBase64,
} from "./runtime/c6AssetTransfer.js";

export {
  LAB_BOARD_PICKER_LABELS,
  LAB_BOARD_GROUP_LABEL,
  LEGACY_BOARD_PICKER_VALUES,
  listLabBoardPickerOptions,
  parseBoardPickerValue,
  applyLabBoardSelection,
  clearLabBoardSelection,
  resolveBoardPickerSelectValue,
  isLabProfileRuntimeReady,
  getLabPickerState,
  labPickerOptionValue,
} from "./ide/boardPicker.js";

export {
  ZB_PROTOCOL_VERSION,
  ZB_FW_ID,
  ZB_HOST_COMMANDS,
  ZB_ONOFF_ACTIONS,
  encodeZbHostCommand,
  decodeZbEvent,
  buildZbBaselineControlSequence,
  isValidDeviceJoinEvent,
  ZIGBEE_COORDINATOR_MANIFEST_PATH,
  ZIGBEE_COORDINATOR_PROJECT_DIR,
  ZIGBEE_COORDINATOR_MANIFEST,
  loadZigbeeCoordinatorManifest,
  isZigbeeCoordinatorSourcePresent,
  isValidatedZigbeePackaging,
  resolveZigbeeCoordinatorArtifact,
  describeZigbeeCoordinatorReadiness,
  ZB_PYTHON_COMMANDS,
  getZigbeeIdeIntegration,
  connectZigbeeWebSerial,
  C6_FIRMWARE_MODE_MICROPYTHON,
  C6_FIRMWARE_MODE_ZIGBEE_COORDINATOR,
  C6_FIRMWARE_MODE_MICROPYTHON_ZIGBEE,
  C6_FIRMWARE_MODES,
  getDefaultC6FirmwareMode,
  getC6FirmwareRuntimeMode,
  setC6FirmwareRuntimeMode,
  clearC6FirmwareRuntimeMode,
  canSelectZigbeeCoordinatorMode,
  canOfferZigbeeCoordinatorFlash,
  canOfferMicroPythonRestoreFlash,
  listC6FirmwareModeDescriptors,
  resolveC6RuntimePathBoundary,
  assertZigbeeFlashExplicitOptIn,
  getC6FirmwareModeSnapshot,
  canSelectMicropythonZigbeeMode,
  canOfferMicropythonZigbeeFlash,
  assertMicropythonZigbeeFlashExplicitOptIn,
  describeMicropythonZigbeeReadiness,
  MICROPYTHON_ZIGBEE_MANIFEST_PATH,
  MICROPYTHON_ZIGBEE_PROJECT_DIR,
  MICROPYTHON_ZIGBEE_MANIFEST,
  loadMicropythonZigbeeManifest,
  isMicropythonZigbeeSourcePresent,
  resolveMicropythonZigbeeArtifact,
} from "./zigbee/index.js";
