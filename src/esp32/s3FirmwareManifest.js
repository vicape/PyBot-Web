/**
 * Pinned official MicroPython image for the Waveshare ESP32-S3R8 (Octal-PSRAM).
 * SHA-256 is mandatory: provisioning fails CLOSED if digest is absent.
 * Stable release: https://micropython.org/download/ESP32_GENERIC_S3/
 */
export const ESP32_S3_OCTAL_FIRMWARE=Object.freeze({
  family:"ESP32-S3",
  chipName:"ESP32-S3",
  board:"ESP32_GENERIC_S3-SPIRAM_OCT",
  version:"1.29.0",
  date:"20260824",
  filename:"ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin",
  url:"/firmware/micropython/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin",
  origin:"https://micropython.org/download/ESP32_GENERIC_S3/",
  originFile:"https://micropython.org/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin",
  license:"MIT",
  // Computed by GitHub Actions directly from the official stable release binary.
  sha256:"ab24eadfe3ef0e6ee38834d730e648def7cd82f3fa51ee0bbc59c29a6e1bd176",
  size:1786704,
  flashOffset:0,
  flashSize:"16MB",
  flashMode:"dio",
  flashFreq:"40m",
});
export function assertS3FirmwareManifest(manifest=ESP32_S3_OCTAL_FIRMWARE){
  if(manifest.board!=="ESP32_GENERIC_S3-SPIRAM_OCT"||
    manifest.flashOffset!==0||manifest.flashSize!=="16MB"||
    !/^[a-f0-9]{64}$/i.test(manifest.sha256||"")||
    !Number.isSafeInteger(manifest.size)||manifest.size<1000000||
    manifest.size>16*1024*1024)
    throw new Error("ESP32_S3_FIRMWARE_NOT_VERIFIED");
  return manifest;
}
