/**
 * Fuente de verdad del firmware MicroPython que PyBot flashea en ESP32 clásico.
 * Offsets, versión, origen, licencia y SHA-256 viven acá (y en
 * public/firmware/micropython/manifest.json, que debe coincidir).
 */

export const MICROPYTHON_FAMILY_CLASSIC = "ESP32";

/** Offset oficial MicroPython para ESP32 (WROOM / GENERIC, 4 MiB). */
export const MICROPYTHON_ESP32_FLASH_OFFSET = 0x1000;

export const MICROPYTHON_LICENSE = "MIT";

export const MICROPYTHON_SOURCE_PAGE = "https://micropython.org/download/ESP32_GENERIC/";

/**
 * Imagen servida desde el propio deploy (public/).
 * SHA-256 del archivo exacto en public/firmware/micropython/.
 */
export const ESP32_GENERIC_FIRMWARE = Object.freeze({
  family: MICROPYTHON_FAMILY_CLASSIC,
  chipName: "ESP32",
  board: "ESP32_GENERIC",
  version: "1.27.0",
  date: "20251209",
  filename: "ESP32_GENERIC-20251209-v1.27.0.bin",
  url: "/firmware/micropython/ESP32_GENERIC-20251209-v1.27.0.bin",
  origin: MICROPYTHON_SOURCE_PAGE,
  originFile:
    "https://micropython.org/resources/firmware/ESP32_GENERIC-20251209-v1.27.0.bin",
  license: MICROPYTHON_LICENSE,
  licenseUrl: "https://github.com/micropython/micropython/blob/v1.27.0/LICENSE",
  sha256: "aa4be80ec695911ba0f13f7558e559ce540f90efbf40c23b853ca49162136b9f",
  size: 1759456,
  flashOffset: MICROPYTHON_ESP32_FLASH_OFFSET,
  flashSize: "4MB",
  flashMode: "dio",
  flashFreq: "40m",
  features: Object.freeze(["BLE", "WLAN", "HTTPS/TLS", "os.dupterm"]),
});

/**
 * Familias detectables por esptool-js CHIP_NAME que todavía no flasheamos.
 * Nunca usar la imagen ESP32_GENERIC en estos chips.
 */
export const UNSUPPORTED_ESP_FAMILIES = Object.freeze([
  "ESP32-S2",
  "ESP32-S3",
  "ESP32-C2",
  "ESP32-C3",
  "ESP32-C5",
  "ESP32-C6",
  "ESP32-C61",
  "ESP32-H2",
  "ESP32-P4",
  "ESP8266",
]);

/**
 * True solo para ESP32 clásico (WROOM/WROVER/SOLO/PICO/MINI de 4 MiB+).
 * @param {string} chipName valor de ESPLoader.main() / chip.CHIP_NAME
 */
export function isClassicEsp32Chip(chipName) {
  const n = String(chipName ?? "").trim();
  if (!n) return false;
  for (const fam of UNSUPPORTED_ESP_FAMILIES) {
    if (n === fam || n.startsWith(fam + " ") || n.startsWith(fam + "(")) {
      return false;
    }
  }
  if (n === "ESP32") return true;
  if (/^ESP32(\s|\(|$)/.test(n) && !/ESP32-[A-Z0-9]/i.test(n)) return true;
  return false;
}

export function firmwarePublicPath(manifest = ESP32_GENERIC_FIRMWARE) {
  return manifest.url;
}
