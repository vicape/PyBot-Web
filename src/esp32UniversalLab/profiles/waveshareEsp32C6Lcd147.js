/**
 * Waveshare ESP32-C6-LCD-1.47 (SKU 28563 / 30381-M)
 * Pin map from Waveshare docs: https://docs.waveshare.com/ESP32-C6-LCD-1.47
 *
 * Zigbee/Thread: SoC has IEEE 802.15.4 radio; MicroPython/Python bindings are
 * NOT VERIFIED on this product path — exposed as UNSUPPORTED until real-device proof.
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";

export const WAVESHARE_ESP32_C6_LCD_147_ID = "waveshare-esp32-c6-lcd-1.47";

export const waveshareEsp32C6Lcd147 = Object.freeze({
  id: WAVESHARE_ESP32_C6_LCD_147_ID,
  commercialName: "Waveshare ESP32-C6-LCD-1.47",
  manufacturer: "Waveshare",
  chipFamily: "esp32c6",
  mcu: "ESP32-C6FH4",
  flashMb: 4,
  psramMb: 0,
  docsUrl: "https://docs.waveshare.com/ESP32-C6-LCD-1.47",
  pinoutSource: "waveshare-docs-esp32-c6-lcd-1.47",
  display: Object.freeze({
    controller: "ST7789",
    width: 172,
    height: 320,
    interface: "spi",
    pins: Object.freeze({
      mosi: 6,
      sclk: 7,
      cs: 14,
      dc: 15,
      rst: 21,
      bl: 22,
    }),
  }),
  reservedPins: Object.freeze({
    lcd: Object.freeze([6, 7, 14, 15, 21, 22]),
    tfCard: Object.freeze([4, 5, 6, 7]),
    rgbLed: Object.freeze([8]),
    bootButton: Object.freeze([9]),
    usb: Object.freeze([12, 13]),
  }),
  availableGpioHeader: Object.freeze([0, 1, 2, 3, 10, 11, 18, 19, 20, 23]),
  peripherals: Object.freeze({
    tfCard: Object.freeze({
      interface: "spi",
      pins: Object.freeze({ miso: 5, mosi: 6, sclk: 7, cs: 4 }),
      note: "Shares SPI bus with LCD; independent CS.",
    }),
    rgbLed: Object.freeze({ din: 8 }),
    bootButton: Object.freeze({ gpio: 9, active: "low" }),
  }),
  /** M1 vertical slice: selectable and programmable via isolated lab runtime. */
  runtimeReady: true,
  hardwareValidation: "UNVERIFIED",
  firmware: Object.freeze({
    target: "esp32c6",
    runtimeFamily: "micropython-compatible",
    imageId: "ESP32_GENERIC_C6",
    imageSha256:
      "111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183",
    version: "1.27.0",
    imageUrl: "/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin",
    origin: "https://micropython.org/download/ESP32_GENERIC_C6/",
    partitionScheme: "micropython-default-offset-0",
    status: CAPABILITY_STATUS.IMPLEMENTED,
    milestone: "M1",
    hardwareValidation: "UNVERIFIED",
  }),
  capabilities: Object.freeze({
    // Source-level IMPLEMENTED under stock MicroPython + lab pybot.* modules.
    // Physical device verification remains UNVERIFIED (see hardwareValidation).
    gpio: CAPABILITY_STATUS.IMPLEMENTED,
    pwm: CAPABILITY_STATUS.IMPLEMENTED,
    adc: CAPABILITY_STATUS.IMPLEMENTED,
    timers: CAPABILITY_STATUS.IMPLEMENTED,
    wifi: CAPABILITY_STATUS.IMPLEMENTED,
    wifiAp: CAPABILITY_STATUS.IMPLEMENTED,
    ble: CAPABILITY_STATUS.IMPLEMENTED,
    display: CAPABILITY_STATUS.IMPLEMENTED,
    touch: CAPABILITY_STATUS.UNSUPPORTED,
    imu: CAPABILITY_STATUS.UNSUPPORTED,
    audio: CAPABILITY_STATUS.UNSUPPORTED,
    i2c: CAPABILITY_STATUS.IMPLEMENTED,
    spi: CAPABILITY_STATUS.IMPLEMENTED,
    uart: CAPABILITY_STATUS.IMPLEMENTED,
    tfCard: CAPABILITY_STATUS.UNVERIFIED,
    powerSleep: CAPABILITY_STATUS.IMPLEMENTED,
    zigbee: CAPABILITY_STATUS.UNSUPPORTED,
    thread: CAPABILITY_STATUS.UNSUPPORTED,
    can: CAPABILITY_STATUS.UNSUPPORTED,
    rs485: CAPABILITY_STATUS.UNSUPPORTED,
  }),
  capabilityNotes: Object.freeze({
    gpio: "Source IMPLEMENTED via machine.Pin + pybot.gpio. Hardware validation: UNVERIFIED.",
    wifi: "Source IMPLEMENTED via network.WLAN in official MicroPython C6 build. Hardware validation: UNVERIFIED.",
    ble: "Source IMPLEMENTED via bluetooth.BLE in official MicroPython C6 build. Hardware validation: UNVERIFIED.",
    display:
      "Source IMPLEMENTED ST7789 driver (pybot.display) using Waveshare pin map. Hardware validation: UNVERIFIED.",
    tfCard: "Pins documented; driver path not exercised — UNVERIFIED.",
    zigbee:
      "NOT VERIFIED / UNSUPPORTED until native stack + Python bindings are proven on this board firmware (M2).",
    thread:
      "NOT VERIFIED / UNSUPPORTED until native stack + Python bindings are proven on this board firmware (M2).",
    touch: "This commercial model has no touch controller.",
  }),
});
