/**
 * Single source of truth for board selection. ESP32-S3 reuses the native
 * MicroPython USB/REPL implementation, never the classic ESP32 ROM flasher.
 *
 * Flashing an S3 from the browser stays disabled until a verified S3
 * (and board-specific PSRAM) firmware asset has been added and physically QA'd.
 */
export const ESP32_S3_MICROPYTHON = "esp32-s3-micropython";

export function isEsp32S3Board(type) {
  return type === ESP32_S3_MICROPYTHON;
}

export function isEsp32MicroPythonBoard(type) {
  return type === "esp32-micropython" || isEsp32S3Board(type);
}

export function isEsp32Board(type) {
  return isEsp32MicroPythonBoard(type) || type === "esp32-eda6";
}
