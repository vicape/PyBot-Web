/**
 * Capa A: ROM bootloader → flash MicroPython vía esptool-js oficial.
 * No habla raw REPL. El caller cierra readers/writers antes de entrar.
 */

import { importEsptool } from "./esptoolLoader.js";
import { ESP32_GENERIC_FIRMWARE, isClassicEsp32Chip } from "./firmwareManifest.js";
import { PROVISION_ERROR } from "./provisioningPhases.js";

function provisionError(code, cause) {
  const err = new Error(code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mensaje exacto de esptool-js 0.6.1 cuando el MD5 local no coincide con el de la flash. */
const ESPTOOL_MD5_MISMATCH = "MD5 of file does not match data in flash!";

function isFlashVerifyError(cause) {
  const msg = String(cause?.message ?? cause ?? "");
  return msg.includes(ESPTOOL_MD5_MISMATCH);
}

/**
 * MD5 (RFC 1321) sobre bytes binarios → 32 hex lowercase.
 * Usado solo como checksum de verificación de flash Espressif (no crypto).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function md5HexBytes(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const bitLen = input.byteLength * 8;
  // padding: 0x80 + zeros + length(64-bit LE), total múltiplo de 64
  const withPad = input.byteLength + 1 + 8;
  const paddedLen = (withPad + 63) & ~63;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.byteLength] = 0x80;
  const view = new DataView(buf.buffer);
  // length in bits, little-endian, low 32 then high 32
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  const rotl = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;
  const M = new Uint32Array(16);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, s[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += out[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function makeTerminal(onLog) {
  return {
    clean() {},
    writeLine(data) {
      onLog?.("[ESPTOOL] " + String(data ?? ""));
    },
    write(data) {
      const s = String(data ?? "");
      if (s.trim()) onLog?.("[ESPTOOL] " + s);
    },
  };
}

/**
 * @param {SerialPort} port
 * @param {{
 *   esptool?: { ESPLoader: Function, Transport: Function },
 *   baudrate?: number,
 *   onLog?: (line: string) => void,
 * }} [options]
 */
export async function connectBootloader(port, options = {}) {
  const mod = options.esptool ?? (await importEsptool());
  const Transport = mod.Transport;
  const ESPLoader = mod.ESPLoader;
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
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
    throw provisionError(PROVISION_ERROR.BOOTLOADER_FAIL, e);
  }
  const name = String(chipName ?? loader.chip?.CHIP_NAME ?? "");
  if (!isClassicEsp32Chip(name) && !isClassicEsp32Chip(loader.chip?.CHIP_NAME)) {
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
    const err = provisionError(PROVISION_ERROR.VARIANT_UNSUPPORTED);
    err.chipName = name || loader.chip?.CHIP_NAME || "unknown";
    throw err;
  }
  return {
    loader,
    transport,
    chipName: name || "ESP32",
    chip: loader.chip,
  };
}

/**
 * @param {{ loader: { eraseFlash: Function } }} ctx
 */
export async function eraseFlash(ctx) {
  try {
    await ctx.loader.eraseFlash();
  } catch (e) {
    throw provisionError(PROVISION_ERROR.ERASE_FAIL, e);
  }
}

/**
 * @param {{ loader: { writeFlash: Function } }} ctx
 * @param {Uint8Array} bytes
 * @param {{
 *   manifest?: typeof ESP32_GENERIC_FIRMWARE,
 *   onProgress?: (info: { bytesWritten: number, bytesTotal: number, pct: number }) => void,
 *   verify?: boolean,
 * }} [options]
 */
export async function writeFirmware(ctx, bytes, options = {}) {
  const manifest = options.manifest ?? ESP32_GENERIC_FIRMWARE;
  const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = image.byteLength;
  const verify = options.verify !== false;
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
        const pct = bytesTotal ? Math.min(100, Math.floor((100 * bytesWritten) / bytesTotal)) : 0;
        options.onProgress?.({ bytesWritten, bytesTotal, pct });
      },
      // esptool-js 0.6.1: MD5 sobre la imagen efectiva (pad/params) vs flashMd5sum interno.
      calculateMD5Hash: verify ? (effectiveImage) => md5HexBytes(effectiveImage) : undefined,
    });
  } catch (e) {
    // Solo el mismatch MD5 exacto de esptool-js → VERIFY. Otros fallos de writeFlash → FLASH_FAIL
    // (p.ej. timeout de "calculate md5sum" sin mensaje distintivo fiable).
    if (verify && isFlashVerifyError(e)) {
      throw provisionError(PROVISION_ERROR.FLASH_VERIFY_FAIL, e);
    }
    throw provisionError(PROVISION_ERROR.FLASH_FAIL, e);
  }
}

/**
 * Reset a modo run y suelta el puerto (readers/writers) para el REPL.
 * @param {{ loader?: { after: Function }, transport?: { disconnect: Function } }} ctx
 */
export async function resetAndRelease(ctx) {
  try {
    if (ctx?.loader && typeof ctx.loader.after === "function") {
      await ctx.loader.after("hard_reset");
    }
  } catch (e) {
    throw provisionError(PROVISION_ERROR.RESET_FAIL, e);
  }
  try {
    if (ctx?.transport && typeof ctx.transport.disconnect === "function") {
      await ctx.transport.disconnect();
    }
  } catch {
    /* el puerto puede desaparecer un instante tras el reset */
  }
  await sleep(400);
}

export async function ensurePortClosed(port) {
  if (!port) return;
  if (port.readable || port.writable) {
    try {
      await port.close();
    } catch {
      /* ignore */
    }
  }
}
