/**
 * Official MicroPython ESP32_GENERIC_C6 image (v1.27.0).
 * SHA-256 verified against the vendored public/ binary before flash is offered.
 * Flash offset 0 per https://micropython.org/download/ESP32_GENERIC_C6/
 */

export const ESP32_GENERIC_C6_FIRMWARE = Object.freeze({
  family: "ESP32-C6",
  chipName: "ESP32-C6",
  board: "ESP32_GENERIC_C6",
  version: "1.27.0",
  date: "20251209",
  filename: "ESP32_GENERIC_C6-20251209-v1.27.0.bin",
  url: "/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
  origin: "https://micropython.org/download/ESP32_GENERIC_C6/",
  originFile:
    "https://micropython.org/resources/firmware/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
  license: "MIT",
  licenseUrl: "https://github.com/micropython/micropython/blob/v1.27.0/LICENSE",
  sha256: "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
  size: 1932000,
  flashOffset: 0,
  flashSize: "4MB",
  flashMode: "dio",
  flashFreq: "80m",
  features: Object.freeze(["BLE", "WLAN", "HTTPS/TLS", "os.dupterm"]),
  hardwareValidation: "UNVERIFIED",
});

/**
 * @param {string} chipName
 * @returns {boolean}
 */
export function isEsp32C6Chip(chipName) {
  const n = String(chipName ?? "").trim();
  if (!n) return false;
  return (
    n === "ESP32-C6" ||
    n.startsWith("ESP32-C6 ") ||
    n.startsWith("ESP32-C6(") ||
    /^ESP32-C6\b/i.test(n)
  );
}
