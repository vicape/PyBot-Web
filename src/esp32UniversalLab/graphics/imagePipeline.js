/**
 * Browser-only PNG/JPG → validated PBI1 RGB565 asset pipeline.
 * No backend upload. Preserves privacy (decode stays in-page).
 */

import {
  MAX_ASSET_BYTES,
  MAX_ASSET_EDGE,
  MAX_FULLSCREEN_BYTES,
  MAX_FULLSCREEN_HEIGHT,
  MAX_FULLSCREEN_WIDTH,
  MAX_SOURCE_EDGE,
  encodePbi,
  imageDataToRgb565LE,
} from "./rgb565.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

/**
 * @param {Uint8Array} bytes
 * @returns {"image/png"|"image/jpeg"}
 */
export function detectImageMime(bytes) {
  if (!bytes || bytes.length < 3) throw new Error("IMAGE_EMPTY");
  let png = true;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) {
      png = false;
      break;
    }
  }
  if (png) return "image/png";
  if (
    bytes[0] === JPEG_SIG[0] &&
    bytes[1] === JPEG_SIG[1] &&
    bytes[2] === JPEG_SIG[2]
  ) {
    return "image/jpeg";
  }
  throw new Error("IMAGE_BAD_SIGNATURE");
}

/**
 * Sanitize original filename to a board-safe stem.
 * @param {string} name
 */
export function assetStemFromName(name) {
  const base = String(name || "image")
    .split(/[/\\]/)
    .pop();
  const stem = base.replace(/\.[^.]+$/, "") || "image";
  const safe = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return safe || "image";
}

/**
 * @param {number} srcW
 * @param {number} srcH
 * @param {{
 *   maxEdge?: number,
 *   maxWidth?: number,
 *   maxHeight?: number,
 *   targetWidth?: number,
 *   targetHeight?: number,
 *   profile?: "icon"|"fullscreen",
 * }} opts
 */
export function computeTargetSize(srcW, srcH, opts = {}) {
  const fullscreen =
    opts.profile === "fullscreen" ||
    (opts.maxWidth != null && opts.maxHeight != null);
  if (fullscreen) {
    const maxW = opts.maxWidth ?? MAX_FULLSCREEN_WIDTH;
    const maxH = opts.maxHeight ?? MAX_FULLSCREEN_HEIGHT;
    if (opts.targetWidth && opts.targetHeight) {
      return {
        width: Math.min(maxW, Math.max(1, opts.targetWidth | 0)),
        height: Math.min(maxH, Math.max(1, opts.targetHeight | 0)),
      };
    }
    const scale = Math.min(1, maxW / srcW, maxH / srcH);
    return {
      width: Math.max(1, Math.round(srcW * scale)),
      height: Math.max(1, Math.round(srcH * scale)),
    };
  }
  const maxEdge = opts.maxEdge ?? MAX_ASSET_EDGE;
  if (opts.targetWidth && opts.targetHeight) {
    return {
      width: Math.min(maxEdge, Math.max(1, opts.targetWidth | 0)),
      height: Math.min(maxEdge, Math.max(1, opts.targetHeight | 0)),
    };
  }
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

/**
 * Decode File/Blob via createImageBitmap + canvas resize/crop.
 * @param {Blob|File} file
 * @param {{
 *   maxEdge?: number,
 *   maxWidth?: number,
 *   maxHeight?: number,
 *   targetWidth?: number,
 *   targetHeight?: number,
 *   profile?: "icon"|"fullscreen",
 *   crop?: { sx: number, sy: number, sw: number, sh: number },
 *   colorKey?: number|null,
 *   originalName?: string,
 * }} [options]
 */
export async function convertImageFileToPbi(file, options = {}) {
  if (!file) throw new Error("IMAGE_NO_FILE");
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE_SOURCE");
  const mime = detectImageMime(buf);
  if (typeof createImageBitmap !== "function") {
    throw new Error("IMAGE_DECODE_UNAVAILABLE");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buf], { type: mime }));
  } catch {
    throw new Error("IMAGE_DECODE_FAIL");
  }
  try {
    const srcW = bitmap.width | 0;
    const srcH = bitmap.height | 0;
    if (srcW < 1 || srcH < 1) throw new Error("IMAGE_ZERO_DIM");
    if (srcW > MAX_SOURCE_EDGE || srcH > MAX_SOURCE_EDGE) {
      throw new Error(`IMAGE_SOURCE_DIM:${srcW}x${srcH}`);
    }

    const crop = options.crop;
    const sx = crop ? crop.sx | 0 : 0;
    const sy = crop ? crop.sy | 0 : 0;
    const sw = crop ? Math.min(srcW - sx, crop.sw | 0) : srcW;
    const sh = crop ? Math.min(srcH - sy, crop.sh | 0) : srcH;
    if (sw < 1 || sh < 1) throw new Error("IMAGE_CROP_INVALID");

    const profile =
      options.profile === "fullscreen" ? "fullscreen" : "icon";
    const sizeOpts =
      profile === "fullscreen"
        ? {
            profile: "fullscreen",
            maxWidth: options.maxWidth ?? MAX_FULLSCREEN_WIDTH,
            maxHeight: options.maxHeight ?? MAX_FULLSCREEN_HEIGHT,
            targetWidth: options.targetWidth,
            targetHeight: options.targetHeight,
          }
        : options;
    const { width, height } = computeTargetSize(sw, sh, sizeOpts);
    const maxBytes =
      profile === "fullscreen" ? MAX_FULLSCREEN_BYTES : MAX_ASSET_BYTES;
    if (width * height * 2 + 12 > maxBytes) {
      throw new Error("IMAGE_ASSET_TOO_BIG");
    }
    if (
      width > MAX_FULLSCREEN_WIDTH ||
      height > MAX_FULLSCREEN_HEIGHT
    ) {
      throw new Error(`IMAGE_DIM_CLIP:${width}x${height}`);
    }

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), {
            width,
            height,
          });
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("IMAGE_CANVAS_FAIL");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    // Only set colorkey flag when caller opts in (transparency)
    const keyOpt =
      options.colorKey != null ? { colorKey: options.colorKey } : {};
    const pixels = imageDataToRgb565LE(imageData, keyOpt);
    const pbi = encodePbi(width, height, pixels, keyOpt);
    const originalName =
      options.originalName ||
      (typeof file.name === "string" ? file.name : "image.png");
    const stem = assetStemFromName(originalName);
    return {
      mime,
      originalName,
      stem,
      boardFileName: `${stem}.pbi`,
      boardPath: `pybot/assets/${stem}.pbi`,
      sourceWidth: srcW,
      sourceHeight: srcH,
      width,
      height,
      profile,
      bytes: pbi,
      byteLength: pbi.length,
      colorOrder: "UNVERIFIED",
      note: "RGB565 LE matches framebuf.RGB565 on ESP32; panel SPI mapping UNVERIFIED",
    };
  } finally {
    try {
      bitmap.close?.();
    } catch {
      /* ignore */
    }
  }
}
