/**
 * Narrow IDE ↔ Zigbee coordinator bridge (M2A).
 * READY path: WebSerial host session + English Python-programmable command map.
 * BLOCKED path: honest status only — never expose Zigbee as READY without validated image.
 * User programming interface remains Python (host-side); not on-device pybot.zigbee.
 */

import {
  encodeZbHostCommand,
  decodeZbEvent,
  ZB_PROTOCOL_VERSION,
} from "./protocol.js";
import {
  canSelectZigbeeCoordinatorMode,
  canOfferZigbeeCoordinatorFlash,
} from "./firmwareModes.js";
import { describeZigbeeCoordinatorReadiness } from "./zigbeeCoordinatorManifest.js";

// Re-export selection gates from firmwareModes (single place for READY gating).
export { canSelectZigbeeCoordinatorMode, canOfferZigbeeCoordinatorFlash };

/**
 * English Python-facing command names → host protocol / CLI.
 * These are HOST-SIDE (USB) helpers for pybot_zb_control.py — not on-device modules.
 */
export const ZB_PYTHON_COMMANDS = Object.freeze({
  "create network": Object.freeze({
    cli: "net-start",
    hostCmd: "net_start",
    encode: () => encodeZbHostCommand("net_start"),
  }),
  "allow joining": Object.freeze({
    cli: "permit-join",
    hostCmd: "permit_join",
    encode: (timeout_s = 60) =>
      encodeZbHostCommand("permit_join", { timeout_s }),
  }),
  status: Object.freeze({
    cli: "status",
    hostCmd: "status",
    encode: () => encodeZbHostCommand("status"),
  }),
  "command on": Object.freeze({
    cli: "onoff --action on",
    hostCmd: "zcl_onoff",
    encode: (short, endpoint = 1) =>
      encodeZbHostCommand("zcl_onoff", { short, endpoint, action: "on" }),
  }),
  "command off": Object.freeze({
    cli: "onoff --action off",
    hostCmd: "zcl_onoff",
    encode: (short, endpoint = 1) =>
      encodeZbHostCommand("zcl_onoff", { short, endpoint, action: "off" }),
  }),
  read: Object.freeze({
    cli: "read-onoff",
    hostCmd: "zcl_onoff_read",
    encode: (short, endpoint = 1) =>
      encodeZbHostCommand("zcl_onoff_read", { short, endpoint }),
  }),
});

/**
 * Snapshot for PyBotIDE: READY only with validated artifact; else BLOCKED.
 * Never returns READY UI affordances without packaging validation.
 */
export function getZigbeeIdeIntegration() {
  const readiness = describeZigbeeCoordinatorReadiness();
  const artifact = readiness.artifact;
  const ready =
    artifact.status === "READY" && canSelectZigbeeCoordinatorMode() === true;

  if (!ready) {
    return Object.freeze({
      status: "BLOCKED",
      hardwareValidation: "UNVERIFIED",
      autoFlash: false,
      webSerialEnabled: false,
      pythonCommands: null,
      protocolVersion: ZB_PROTOCOL_VERSION,
      blockReason:
        artifact.blockReason ||
        "Zigbee coordinator artifact not READY (build with ESP-IDF v5.5.4)",
      restoreMicroPython: readiness.restoreMicroPython,
      note:
        "Zigbee WebSerial host path disabled until a validated merged/multi-offset artifact exists. Default MicroPython path unchanged.",
    });
  }

  return Object.freeze({
    status: "READY",
    hardwareValidation: "UNVERIFIED",
    autoFlash: false,
    webSerialEnabled: true,
    pythonCommands: ZB_PYTHON_COMMANDS,
    protocolVersion: ZB_PROTOCOL_VERSION,
    blockReason: null,
    artifact,
    restoreMicroPython: readiness.restoreMicroPython,
    encodeZbHostCommand,
    decodeZbEvent,
    note:
      "Validated Zigbee artifact present. Host control is Python over USB (create network, allow joining, status, command on/off, read). Physical pairing remains UNVERIFIED. autoFlash=false.",
  });
}

/**
 * Open a WebSerial port for Zigbee host JSON protocol.
 * Refuses unless artifact READY. Does not flash firmware.
 * @param {{ baudRate?: number, requestPort?: () => Promise<SerialPort> }} [options]
 */
export async function connectZigbeeWebSerial(options = {}) {
  const integ = getZigbeeIdeIntegration();
  if (integ.status !== "READY" || !integ.webSerialEnabled) {
    throw new Error(
      `PYBOT_ZB:BLOCKED ${integ.blockReason || "artifact not READY"}`,
    );
  }
  if (typeof navigator === "undefined" || !("serial" in navigator)) {
    throw new Error("PYBOT_ZB:BLOCKED WebSerial not available in this browser");
  }
  const port =
    typeof options.requestPort === "function"
      ? await options.requestPort()
      : await navigator.serial.requestPort();
  const baudRate = options.baudRate ?? 115200;
  await port.open({ baudRate });
  return {
    port,
    protocolVersion: ZB_PROTOCOL_VERSION,
    encode: encodeZbHostCommand,
    decode: decodeZbEvent,
    pythonCommands: ZB_PYTHON_COMMANDS,
  };
}
