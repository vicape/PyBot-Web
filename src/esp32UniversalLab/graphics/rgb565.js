/**
 * Browser RGB565 helpers matching MicroPython framebuf.RGB565 byte order
 * on little-endian ESP32 (low byte first). Physical panel color mapping:
 * UNVERIFIED until operator bench (red/green/blue/black/white/checkerboard).
 */

/** PBI format version magic */
export const PBI_MAGIC = "PBI1";

/** Physical ST7789 panel (must match pybot.display WIDTH/HEIGHT) */
export const LCD_WIDTH = 172;
export const LCD_HEIGHT = 320;

/** Max source decode dimension (reject earlier) */
export const MAX_SOURCE_EDGE = 2048;

/**
 * Icon / demo profile: longest edge ≤ 128.
 * Keeps flash use small for multiple small assets on 4MB / no-PSRAM C6.
 */
export const MAX_ASSET_EDGE = 128;

/** Soft cap on encoded icon-profile asset bytes (header + pixels) */
export const MAX_ASSET_BYTES = 12 + MAX_ASSET_EDGE * MAX_ASSET_EDGE * 2;

/**
 * Full-screen photograph profile: fit within 172×320.
 * Encoded size = 12 + 172*320*2 = 110092 bytes. Safe because:
 * - transfer is chunked (no full base64 decode of the whole file on MCU heap),
 * - lcd.image() streams one row (≤ 344 bytes) into the existing framebuffer,
 * - no second display-sized buffer is allocated.
 * Flash still probed at upload time; multiple full-screen assets may fill FS.
 */
export const MAX_FULLSCREEN_WIDTH = LCD_WIDTH;
export const MAX_FULLSCREEN_HEIGHT = LCD_HEIGHT;
export const MAX_FULLSCREEN_BYTES =
  12 + MAX_FULLSCREEN_WIDTH * MAX_FULLSCREEN_HEIGHT * 2;

/**
 * Pack 8-bit RGB into RGB565 integer (same formula as pybot.display.color).
 * @param {number} r @param {number} g @param {number} b
 */
export function rgbTo565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/**
 * Write RGB565 as little-endian bytes into out[offset].
 * Matches ESP32 MicroPython framebuf.RGB565 buffer layout.
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} c565
 */
export function writeRgb565LE(out, offset, c565) {
  out[offset] = c565 & 0xff;
  out[offset + 1] = (c565 >> 8) & 0xff;
}

/**
 * Read LE RGB565 from buffer.
 * @param {Uint8Array|number[]} buf
 * @param {number} offset
 */
export function readRgb565LE(buf, offset) {
  return (buf[offset] | (buf[offset + 1] << 8)) & 0xffff;
}

/**
 * Convert RGBA ImageData (or compatible) to LE RGB565 pixel bytes (no header).
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} imageData
 * @param {{ colorKey?: number|null }} [opts]
 * @returns {Uint8Array}
 */
export function imageDataToRgb565LE(imageData, opts = {}) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(width * height * 2);
  let o = 0;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const a = data[p + 3];
    let c;
    if (a < 16 && opts.colorKey != null) {
      c = opts.colorKey & 0xffff;
    } else {
      c = rgbTo565(data[p], data[p + 1], data[p + 2]);
    }
    writeRgb565LE(out, o, c);
    o += 2;
  }
  return out;
}

/**
 * Encode PBI1 asset: magic + w/h LE + flags + colorkey + LE RGB565 pixels.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixelsLE
 * @param {{ colorKey?: number|null }} [opts]
 */
export function encodePbi(width, height, pixelsLE, opts = {}) {
  const w = width | 0;
  const h = height | 0;
  if (
    w <= 0 ||
    h <= 0 ||
    w > MAX_FULLSCREEN_WIDTH ||
    h > MAX_FULLSCREEN_HEIGHT
  ) {
    throw new Error(`PBI_DIM_INVALID:${w}x${h}`);
  }
  const expect = w * h * 2;
  if (12 + expect > MAX_FULLSCREEN_BYTES) {
    throw new Error(`PBI_TOO_BIG:${w}x${h}`);
  }
  if (!pixelsLE || pixelsLE.length !== expect) {
    throw new Error(`PBI_PIXELS_LEN:${pixelsLE?.length ?? 0}!=${expect}`);
  }
  const hasKey = opts.colorKey != null;
  const hdr = new Uint8Array(12);
  hdr[0] = 0x50; // P
  hdr[1] = 0x42; // B
  hdr[2] = 0x49; // I
  hdr[3] = 0x31; // 1
  hdr[4] = w & 0xff;
  hdr[5] = (w >> 8) & 0xff;
  hdr[6] = h & 0xff;
  hdr[7] = (h >> 8) & 0xff;
  hdr[8] = hasKey ? 1 : 0;
  hdr[9] = 0;
  const ck = hasKey ? opts.colorKey & 0xffff : 0;
  hdr[10] = ck & 0xff;
  hdr[11] = (ck >> 8) & 0xff;
  const out = new Uint8Array(12 + expect);
  out.set(hdr, 0);
  out.set(pixelsLE, 12);
  return out;
}

/**
 * Decode PBI1 header + pixels.
 * @param {Uint8Array} bytes
 */
export function decodePbi(bytes) {
  if (!bytes || bytes.length < 12) throw new Error("PBI_TOO_SHORT");
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x42 ||
    bytes[2] !== 0x49 ||
    bytes[3] !== 0x31
  ) {
    throw new Error("PBI_BAD_MAGIC");
  }
  const width = bytes[4] | (bytes[5] << 8);
  const height = bytes[6] | (bytes[7] << 8);
  const flags = bytes[8];
  const colorKey = bytes[10] | (bytes[11] << 8);
  const expect = width * height * 2;
  if (bytes.length < 12 + expect) throw new Error("PBI_TRUNCATED");
  return {
    width,
    height,
    flags,
    colorKey,
    pixels: bytes.subarray(12, 12 + expect),
  };
}

/**
 * Rolling checksum used by C6 asset transfer (length + sum32).
 * @param {Uint8Array} bytes
 */
export function checksumSum32(bytes) {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) {
    s = (s + bytes[i]) >>> 0;
  }
  return s;
}
