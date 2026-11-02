/**
 * Official, non-destructive hand-off for ESP32-S3 MicroPython.
 * No binary is bundled or selected by PyBot: the user reviews/downloads the
 * exact Octal-SPIRAM .bin and explicitly flashes using Espressif's tool.
 * The classic ESP32 esptool path and its 0x1000 image remain untouched.
 */
export const ESP32_S3_FIRMWARE_GUIDE = Object.freeze({
  board: "Waveshare ESP32-S3-Touch-LCD-1.54",
  chip: "ESP32-S3",
  variant: "ESP32_GENERIC_S3 / Firmware (Support for Octal-SPIRAM)",
  sourceUrl: "https://micropython.org/download/ESP32_GENERIC_S3/",
  flashToolUrl: "https://espressif.github.io/esptool-js/",
  flashOffset: 0x0,
  requiresExplicitEraseConsent: true,
});
