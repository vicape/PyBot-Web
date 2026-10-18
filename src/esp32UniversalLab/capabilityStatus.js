/**
 * Capability verification states for ESP32 Universal Lab profiles.
 * Never claim physical verification without device evidence.
 */

export const CAPABILITY_STATUS = Object.freeze({
  /** Source-level API + drivers exist and unit-tested; not yet proven on device. */
  IMPLEMENTED: "implemented",
  /** Planned for a later milestone; not exposed as usable. */
  PLANNED: "planned",
  /** Hardware/firmware path exists but lacks real-device proof. */
  UNVERIFIED: "unverified",
  /** Explicitly not available on this board or firmware. */
  UNSUPPORTED: "unsupported",
  /** Blocked by toolchain, access, or product decision. */
  BLOCKED: "blocked",
});

/**
 * @param {string} status
 * @returns {boolean}
 */
export function isCapabilityUsable(status) {
  return status === CAPABILITY_STATUS.IMPLEMENTED;
}

/**
 * @param {string} status
 * @returns {boolean}
 */
export function isCapabilityExplicitlyUnavailable(status) {
  return (
    status === CAPABILITY_STATUS.UNSUPPORTED ||
    status === CAPABILITY_STATUS.BLOCKED ||
    status === CAPABILITY_STATUS.PLANNED ||
    status === CAPABILITY_STATUS.UNVERIFIED
  );
}
