/**
 * PyBot ↔ native Zigbee coordinator USB line protocol (M2A).
 * Newline-delimited JSON. No mock radio — frames target real firmware only.
 */

export const ZB_PROTOCOL_VERSION = 1;
export const ZB_FW_ID = "pybot-zb-coord";

/** @typedef {'ping'|'status'|'net_start'|'permit_join'|'permit_join_close'|'zcl_onoff'|'zcl_onoff_read'} ZbHostCommand */

export const ZB_HOST_COMMANDS = Object.freeze([
  "ping",
  "status",
  "net_start",
  "permit_join",
  "permit_join_close",
  "zcl_onoff",
  "zcl_onoff_read",
]);

export const ZB_ONOFF_ACTIONS = Object.freeze(["on", "off", "toggle"]);

/**
 * @param {ZbHostCommand} cmd
 * @param {Record<string, unknown>} [fields]
 * @returns {string} single JSON line without trailing newline
 */
export function encodeZbHostCommand(cmd, fields = {}) {
  if (!ZB_HOST_COMMANDS.includes(cmd)) {
    throw new Error(`Unknown Zigbee host command: ${cmd}`);
  }
  if (cmd === "permit_join") {
    const t = Number(fields.timeout_s ?? 60);
    if (!Number.isFinite(t) || t < 1 || t > 254) {
      throw new Error("permit_join timeout_s must be 1..254");
    }
    return JSON.stringify({ cmd, timeout_s: Math.floor(t) });
  }
  if (cmd === "zcl_onoff") {
    const action = String(fields.action ?? "");
    if (!ZB_ONOFF_ACTIONS.includes(action)) {
      throw new Error(`zcl_onoff action must be one of ${ZB_ONOFF_ACTIONS.join("|")}`);
    }
    const shortAddr = Number(fields.short);
    const endpoint = Number(fields.endpoint ?? 1);
    if (!Number.isFinite(shortAddr) || shortAddr < 0 || shortAddr > 0xffff) {
      throw new Error("zcl_onoff short must be 0..65535");
    }
    if (!Number.isFinite(endpoint) || endpoint < 1 || endpoint > 240) {
      throw new Error("zcl_onoff endpoint must be 1..240");
    }
    return JSON.stringify({
      cmd,
      short: Math.floor(shortAddr),
      endpoint: Math.floor(endpoint),
      action,
    });
  }
  if (cmd === "zcl_onoff_read") {
    const shortAddr = Number(fields.short);
    const endpoint = Number(fields.endpoint ?? 1);
    if (!Number.isFinite(shortAddr) || shortAddr < 0 || shortAddr > 0xffff) {
      throw new Error("zcl_onoff_read short must be 0..65535");
    }
    if (!Number.isFinite(endpoint) || endpoint < 1 || endpoint > 240) {
      throw new Error("zcl_onoff_read endpoint must be 1..240");
    }
    return JSON.stringify({
      cmd,
      short: Math.floor(shortAddr),
      endpoint: Math.floor(endpoint),
    });
  }
  return JSON.stringify({ cmd, ...fields });
}

/**
 * @param {string} line
 * @returns {{ evt: string, [k: string]: unknown }}
 */
export function decodeZbEvent(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty Zigbee event line");
  }
  const data = JSON.parse(trimmed);
  if (!data || typeof data !== "object" || typeof data.evt !== "string") {
    throw new Error("Zigbee event missing evt field");
  }
  return data;
}

/**
 * Build a minimal happy-path command sequence for host adapters / tests.
 * Does not touch hardware.
 * @returns {readonly string[]}
 */
export function buildZbBaselineControlSequence() {
  return Object.freeze([
    encodeZbHostCommand("ping"),
    encodeZbHostCommand("status"),
    encodeZbHostCommand("net_start"),
    encodeZbHostCommand("permit_join", { timeout_s: 60 }),
    encodeZbHostCommand("zcl_onoff", { short: 0x1234, endpoint: 1, action: "on" }),
    encodeZbHostCommand("zcl_onoff_read", { short: 0x1234, endpoint: 1 }),
    encodeZbHostCommand("permit_join_close"),
  ]);
}

/**
 * Validate a device_joined / device_annce style event shape.
 * @param {object} evt
 */
export function isValidDeviceJoinEvent(evt) {
  if (!evt || typeof evt !== "object") return false;
  if (evt.evt !== "device_joined" && evt.evt !== "device_annce") return false;
  if (typeof evt.short !== "number") return false;
  if (typeof evt.ieee !== "string" || !/^0x[0-9a-fA-F]+$/.test(evt.ieee)) return false;
  if (evt.evt === "device_joined") {
    if (!Array.isArray(evt.endpoints) || evt.endpoints.length < 1) return false;
  }
  return true;
}
