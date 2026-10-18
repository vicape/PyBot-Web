/**
 * Planned English Python API surface for Universal Lab (pybot.* modules).
 * M0 lists the contract names only. Modules are exposed to students only when
 * the matching board capability status is IMPLEMENTED.
 */

import { getCapability } from "../profiles/index.js";
import { CAPABILITY_STATUS } from "../capabilityStatus.js";

/** @type {ReadonlyArray<{ module: string, capability: string, description: string }>} */
export const PYBOT_PYTHON_API_MODULES = Object.freeze([
  Object.freeze({
    module: "pybot.gpio",
    capability: "gpio",
    description: "Digital / PWM / ADC GPIO helpers",
  }),
  Object.freeze({
    module: "pybot.wifi",
    capability: "wifi",
    description: "Wi-Fi client and AP",
  }),
  Object.freeze({
    module: "pybot.bluetooth",
    capability: "ble",
    description: "BLE / GATT helpers",
  }),
  Object.freeze({
    module: "pybot.zigbee",
    capability: "zigbee",
    description:
      "Zigbee MicroPython module (not available — use opt-in native coordinator + USB host protocol in M2A)",
  }),
  Object.freeze({
    module: "pybot.display",
    capability: "display",
    description: "Onboard LCD / RGB panel",
  }),
  Object.freeze({
    module: "pybot.touch",
    capability: "touch",
    description: "Capacitive touch",
  }),
  Object.freeze({
    module: "pybot.imu",
    capability: "imu",
    description: "Inertial measurement unit",
  }),
  Object.freeze({
    module: "pybot.audio",
    capability: "audio",
    description: "Microphone / speaker",
  }),
  Object.freeze({
    module: "pybot.power",
    capability: "battery",
    description: "Battery / sleep / power rails",
  }),
]);

/**
 * Modules students may import for a profile (IMPLEMENTED only).
 * @param {string} profileId
 * @returns {readonly string[]}
 */
export function listUsablePythonModules(profileId) {
  return Object.freeze(
    PYBOT_PYTHON_API_MODULES.filter((entry) => {
      const capName =
        entry.capability === "battery"
          ? resolvePowerCapability(profileId)
          : entry.capability;
      return getCapability(profileId, capName).usable;
    }).map((entry) => entry.module),
  );
}

/**
 * @param {string} profileId
 * @param {string} moduleName  e.g. "pybot.gpio"
 */
export function describePythonModuleAvailability(profileId, moduleName) {
  const entry = PYBOT_PYTHON_API_MODULES.find((m) => m.module === moduleName);
  if (!entry) {
    return {
      module: moduleName,
      status: CAPABILITY_STATUS.UNSUPPORTED,
      usable: false,
      note: `Unknown Python module: ${moduleName}`,
    };
  }
  const capName =
    entry.capability === "battery"
      ? resolvePowerCapability(profileId)
      : entry.capability;
  const info = getCapability(profileId, capName);
  return {
    module: moduleName,
    status: info.status,
    usable: info.usable,
    note: info.note,
    capability: capName,
  };
}

/** Prefer explicit battery capability; fall back to powerSleep for C6. */
function resolvePowerCapability(profileId) {
  const battery = getCapability(profileId, "battery");
  if (battery.status !== CAPABILITY_STATUS.UNSUPPORTED) return "battery";
  return "powerSleep";
}
