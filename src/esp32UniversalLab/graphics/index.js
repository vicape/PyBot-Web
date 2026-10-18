/**
 * ESP32 Universal Lab C6 graphics — browser RGB565 / PBI helpers.
 */

export {
  PBI_MAGIC,
  LCD_WIDTH,
  LCD_HEIGHT,
  MAX_SOURCE_EDGE,
  MAX_ASSET_EDGE,
  MAX_ASSET_BYTES,
  MAX_FULLSCREEN_WIDTH,
  MAX_FULLSCREEN_HEIGHT,
  MAX_FULLSCREEN_BYTES,
  rgbTo565,
  writeRgb565LE,
  readRgb565LE,
  imageDataToRgb565LE,
  encodePbi,
  decodePbi,
  checksumSum32,
} from "./rgb565.js";

export {
  detectImageMime,
  assetStemFromName,
  computeTargetSize,
  convertImageFileToPbi,
} from "./imagePipeline.js";
