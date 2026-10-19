/**
 * Isolated ESP32-C6 MicroPython flasher for Universal Lab.
 * Does NOT modify legacy esp32/esp32Flasher.js (classic ESP32 only).
 */

import { importEsptool } from "../../esp32/esptoolLoader.js";
import {
  ESP32_GENERIC_C6_FIRMWARE,
  isEsp32C6Chip,
} from "../firmware/esp32GenericC6.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<string>} lowercase hex sha256
 */
export async function sha256Hex(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Fetch firmware and validate size + SHA-256 before any flash offer/write.
 * @param {typeof ESP32_GENERIC_C6_FIRMWARE} [manifest]
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ bytes: Uint8Array, manifest: typeof ESP32_GENERIC_C6_FIRMWARE, sha256: string }>}
 */
export async function loadAndValidateC6Firmware(manifest = ESP32_GENERIC_C6_FIRMWARE, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("FIRMWARE_FETCH_UNAVAILABLE");
  }
  if (!manifest?.url || !manifest?.sha256 || !manifest?.version) {
    throw new Error("FIRMWARE_MANIFEST_INCOMPLETE");
  }
  const res = await fetchImpl(manifest.url);
  if (!res.ok) {
    throw new Error(`FIRMWARE_FETCH_FAIL:${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (typeof manifest.size === "number" && bytes.byteLength !== manifest.size) {
    throw new Error(
      `FIRMWARE_SIZE_MISMATCH:expected=${manifest.size} got=${bytes.byteLength}`,
    );
  }
  const sha = await sha256Hex(bytes);
  if (sha !== manifest.sha256) {
    throw new Error(
      `FIRMWARE_SHA256_MISMATCH:expected=${manifest.sha256} got=${sha}`,
    );
  }
  return { bytes, manifest, sha256: sha };
}

function makeTerminal(onLog) {
  return {
    clean() {},
    writeLine(data) {
      onLog?.("[LAB-ESPTOOL] " + String(data ?? ""));
    },
    write(data) {
      const s = String(data ?? "");
      if (s.trim()) onLog?.("[LAB-ESPTOOL] " + s);
    },
  };
}

/**
 * @param {SerialPort} port
 * @param {{ onLog?: (line: string) => void, baudrate?: number }} [options]
 */
export async function connectC6Bootloader(port, options = {}) {
  const mod = await importEsptool();
  const transport = new mod.Transport(port, false);
  const loader = new mod.ESPLoader({
    transport,
    baudrate: options.baudrate ?? 115200,
    romBaudrate: 115200,
    terminal: makeTerminal(options.onLog),
    debugLogging: false,
  });
  let chipName;
  try {
    chipName = await loader.main("default_reset");
  } catch (e) {
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }
    const err = new Error("LAB_BOOTLOADER_FAIL");
    err.cause = e;
    throw err;
  }
  const name = String(chipName ?? loader.chip?.CHIP_NAME ?? "");
  if (!isEsp32C6Chip(name) && !isEsp32C6Chip(loader.chip?.CHIP_NAME)) {
    try {
      await loader.after("hard_reset");
    } catch {
      /* ignore */
    }
    try {
      await transport.disconnect();
    } catch {
      /* ignore */
    }
    const err = new Error("LAB_CHIP_NOT_C6");
    err.chipName = name || "unknown";
    throw err;
  }
  return { loader, transport, chipName: name || "ESP32-C6", chip: loader.chip };
}

/**
 * @param {{ loader: { writeFlash: Function } }} ctx
 * @param {Uint8Array} bytes
 * @param {{
 *   manifest?: typeof ESP32_GENERIC_C6_FIRMWARE,
 *   onProgress?: (info: { bytesWritten: number, bytesTotal: number, pct: number }) => void,
 * }} [options]
 */
export async function writeC6Firmware(ctx, bytes, options = {}) {
  const manifest = options.manifest ?? ESP32_GENERIC_C6_FIRMWARE;
  const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = image.byteLength;
  try {
    await ctx.loader.writeFlash({
      fileArray: [{ data: image, address: manifest.flashOffset }],
      flashMode: manifest.flashMode,
      flashFreq: manifest.flashFreq,
      flashSize: manifest.flashSize,
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, fileTotal) => {
        const bytesTotal = fileTotal || total;
        const bytesWritten = written;
        const pct = bytesTotal
          ? Math.min(100, Math.floor((100 * bytesWritten) / bytesTotal))
          : 0;
        options.onProgress?.({ bytesWritten, bytesTotal, pct });
      },
    });
  } catch (e) {
    const err = new Error("LAB_FLASH_FAIL");
    err.cause = e;
    throw err;
  }
}

/**
 * ESP32-C6 private-bench, multi-offset flashing. Caller MUST verify 3 SHA256
 * hashes and double consent before invoking; this layer independently enforces
 * fixed offsets, size boundaries and ESP32-C6 silicon identity.
 * No automatic invocation and no effect on stock single-image flash.
 */
export async function writeC6MultiOffsetFirmware(ctx, segments, options = {}) {
  if (!Array.isArray(segments) || segments.length !== 3) {
    throw new Error("LAB_MULTI_OFFSET_NEED_THREE");
  }
  const chipName = String(ctx?.chipName || ctx?.chip?.CHIP_NAME || "");
  if (!isEsp32C6Chip(chipName)) throw new Error("LAB_CHIP_NOT_C6");
  if (typeof ctx?.loader?.writeFlash !== "function") {
    throw new Error("LAB_BOOTLOADER_NOT_CONNECTED");
  }
  const slots = [
    { role: "bootloader", address: 0x0, max: 0x8000 },
    { role: "partition-table", address: 0x8000, max: 0x8000 },
    { role: "app", address: 0x10000, max: 0x390000 },
  ];
  const fileArray = slots.map((slot) => {
    const segment = segments.find((s) => s?.role === slot.role);
    if (!segment || segment.address !== slot.address || !(segment.data instanceof Uint8Array) ||
        segment.data.byteLength < 64 || segment.data.byteLength > slot.max) {
      throw new Error("LAB_MULTI_OFFSET_INVALID:" + slot.role);
    }
    return { address: slot.address, data: segment.data };
  });
  let total = 0;
  for (const file of fileArray) total += file.data.byteLength;
  try {
    await ctx.loader.writeFlash({
      fileArray,
      flashMode: "dio",
      flashFreq: "80m",
      flashSize: "4MB",
      eraseAll: true, // Full backup and erasure consent required by the caller.
      compress: true,
      reportProgress: (fileIndex, written, fileTotal) => {
        options.onProgress?.({
          fileIndex,
          bytesWritten: written,
          bytesTotal: fileTotal || total,
          pct: Math.min(100, Math.floor(100 * written / (fileTotal || total))),
        });
      },
    });
  } catch (e) {
    const err = new Error("LAB_MULTI_OFFSET_FLASH_FAILED");
    err.cause = e;
    throw err;
  }
}

/**
 * @param {{ loader?: { after: Function }, transport?: { disconnect: Function } }} ctx
 */
export async function resetC6AndRelease(ctx) {
  try {
    if (ctx?.loader && typeof ctx.loader.after === "function") {
      await ctx.loader.after("hard_reset");
    }
  } catch (e) {
    const err = new Error("LAB_RESET_FAIL");
    err.cause = e;
    throw err;
  }
  try {
    if (ctx?.transport && typeof ctx.transport.disconnect === "function") {
      await ctx.transport.disconnect();
    }
  } catch {
    /* port may drop briefly after reset */
  }
  await sleep(400);
}
