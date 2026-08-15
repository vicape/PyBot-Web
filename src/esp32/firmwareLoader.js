/**
 * Carga la imagen MicroPython del deploy y verifica SHA-256 ANTES de flashear.
 */

import { sha256Hex } from "../bleProtocol.js";
import { ESP32_GENERIC_FIRMWARE } from "./firmwareManifest.js";
import { PROVISION_ERROR } from "./provisioningPhases.js";

function provisionError(code, cause) {
  const err = new Error(code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

/**
 * @param {{ fetchImpl?: typeof fetch, manifest?: typeof ESP32_GENERIC_FIRMWARE }} [options]
 * @returns {Promise<{ bytes: Uint8Array, sha256: string, manifest: object }>}
 */
export async function loadOfficialFirmware(options = {}) {
  const manifest = options.manifest ?? ESP32_GENERIC_FIRMWARE;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw provisionError(PROVISION_ERROR.FIRMWARE_FETCH_FAIL);
  }
  let res;
  try {
    res = await fetchImpl(manifest.url);
  } catch (e) {
    throw provisionError(PROVISION_ERROR.FIRMWARE_FETCH_FAIL, e);
  }
  if (!res || !res.ok) {
    throw provisionError(PROVISION_ERROR.FIRMWARE_FETCH_FAIL);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (typeof manifest.size === "number" && bytes.byteLength !== manifest.size) {
    throw provisionError(PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
  }
  const sha256 = sha256Hex(bytes);
  if (sha256 !== String(manifest.sha256).toLowerCase()) {
    throw provisionError(PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
  }
  return { bytes, sha256, manifest };
}

export function assertFirmwareHash(bytes, expectedSha256) {
  const sha256 = sha256Hex(bytes);
  if (sha256 !== String(expectedSha256).toLowerCase()) {
    throw provisionError(PROVISION_ERROR.FIRMWARE_HASH_MISMATCH);
  }
  return sha256;
}
