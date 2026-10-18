/**
 * Isolated session holder for Universal Lab.
 * Never shares state with hardwareBridge legacy adapters.
 */

/** @type {import("../../micropython/micropythonSession.js").MicroPythonSession | null} */
let _session = null;
/** @type {string | null} */
let _profileId = null;
/** @type {number | null} */
let _baudRate = null;
/** @type {any} */
let _port = null;

export function getLabSession() {
  return _session;
}

export function getLabSessionProfileId() {
  return _profileId;
}

export function isLabSessionConnected() {
  return _session != null;
}

export function getLabSessionBaudRate() {
  return _baudRate;
}

/**
 * @param {{
 *   session: object,
 *   profileId: string,
 *   baudRate?: number,
 *   port?: any,
 * }} info
 */
export function setLabSession(info) {
  _session = info.session ?? null;
  _profileId = info.profileId ?? null;
  _baudRate = info.baudRate ?? null;
  _port = info.port ?? null;
}

export async function clearLabSession() {
  const session = _session;
  const port = _port;
  _session = null;
  _profileId = null;
  _baudRate = null;
  _port = null;
  if (session && typeof session.close === "function") {
    try {
      await session.close();
    } catch {
      /* ignore */
    }
  }
  if (port && typeof port.close === "function") {
    try {
      if (port.readable || port.writable) await port.close();
    } catch {
      /* ignore */
    }
  }
}
